import { neon } from "@neondatabase/serverless";

// Collections de l'app. Le contenu de chaque document est chiffré dans le navigateur :
// le serveur ne stocke que { v, iv, ct } et ne peut pas le lire.
export const COLLS = ["config", "recurring", "ops", "accounts", "projects", "banks"];
const ID_RE = /^[A-Za-z0-9_\-.:]{1,80}$/;
const MAX_CT = 96 * 1024;
const MAX_OPS = 500;

let _sql = null;
let _schema = null;

function db() {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL manquante : connecte une base Neon au projet Vercel.");
    _sql = neon(url);
  }
  return _sql;
}

export function schema() {
  if (!_schema) {
    const sql = db();
    _schema = (async () => {
      await sql`/*q:schema_users*/ CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text UNIQUE NOT NULL,
        auth_hash text NOT NULL,
        recovery_hash text NOT NULL,
        protected_key jsonb NOT NULL,
        recovery_key jsonb NOT NULL,
        session_ver int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`/*q:schema_vault*/ CREATE TABLE IF NOT EXISTS vault (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coll text NOT NULL,
        id text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, coll, id)
      )`;
      await sql`/*q:schema_rate*/ CREATE TABLE IF NOT EXISTS rate_limits (
        k text PRIMARY KEY,
        n int NOT NULL,
        reset_at timestamptz NOT NULL
      )`;
    })().catch(e => { _schema = null; throw e; });
  }
  return _schema;
}

const parse = v => (typeof v === "string" ? JSON.parse(v) : v);

/* ---------- Utilisateurs ---------- */
export async function findUserByEmail(email) {
  await schema();
  const r = await db()`/*q:user_by_email*/ SELECT * FROM users WHERE email = ${email}`;
  return r[0] ? { ...r[0], protected_key: parse(r[0].protected_key), recovery_key: parse(r[0].recovery_key) } : null;
}
export async function findUserById(id) {
  await schema();
  const r = await db()`/*q:user_by_id*/ SELECT * FROM users WHERE id = ${id}`;
  return r[0] ? { ...r[0], protected_key: parse(r[0].protected_key), recovery_key: parse(r[0].recovery_key) } : null;
}
export async function createUser(u) {
  await schema();
  try {
    const r = await db()`/*q:user_insert*/ INSERT INTO users (email, auth_hash, recovery_hash, protected_key, recovery_key)
      VALUES (${u.email}, ${u.auth_hash}, ${u.recovery_hash}, ${JSON.stringify(u.protected_key)}::jsonb, ${JSON.stringify(u.recovery_key)}::jsonb)
      RETURNING id, session_ver`;
    return r[0];
  } catch (e) {
    if (e && (e.code === "23505" || /duplicate|unique/i.test(e.message))) return null;
    throw e;
  }
}
export async function setPassword(id, auth_hash, protected_key) {
  await schema();
  const r = await db()`/*q:user_set_password*/ UPDATE users SET auth_hash = ${auth_hash}, protected_key = ${JSON.stringify(protected_key)}::jsonb, session_ver = session_ver + 1
    WHERE id = ${id} RETURNING session_ver`;
  return r[0]?.session_ver;
}
export async function setRecovery(id, recovery_hash, recovery_key) {
  await schema();
  await db()`/*q:user_set_recovery*/ UPDATE users SET recovery_hash = ${recovery_hash}, recovery_key = ${JSON.stringify(recovery_key)}::jsonb WHERE id = ${id}`;
}
export async function deleteUser(id) {
  await schema();
  const sql = db();
  await sql.transaction([
    sql`/*q:vault_delete_user*/ DELETE FROM vault WHERE user_id = ${id}`,
    sql`/*q:user_delete*/ DELETE FROM users WHERE id = ${id}`,
  ]);
}

/* ---------- Données chiffrées ---------- */
export async function getState(uid) {
  await schema();
  const rows = await db()`/*q:vault_select*/ SELECT coll, id, data FROM vault WHERE user_id = ${uid}`;
  return rows.map(r => ({ coll: r.coll, id: r.id, data: parse(r.data) }));
}

export function validateOps(ops) {
  if (!Array.isArray(ops)) return "ops doit être une liste";
  if (ops.length > MAX_OPS) return `trop d'opérations (max ${MAX_OPS})`;
  for (const o of ops) {
    if (!o || (o.op !== "put" && o.op !== "del")) return "op inconnue";
    if (!COLLS.includes(o.coll)) return "collection inconnue";
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) return "identifiant invalide";
    if (o.op === "put") {
      const d = o.data;
      if (!d || d.v !== 1 || typeof d.iv !== "string" || typeof d.ct !== "string" || d.iv.length > 32 || d.ct.length > MAX_CT || Object.keys(d).length !== 3)
        return "document chiffré invalide";
    }
  }
  return null;
}

export async function applyOps(uid, ops) {
  if (!ops.length) return 0;
  await schema();
  const sql = db();
  const stmts = ops.map(o => o.op === "del"
    ? sql`/*q:vault_delete*/ DELETE FROM vault WHERE user_id = ${uid} AND coll = ${o.coll} AND id = ${o.id}`
    : sql`/*q:vault_upsert*/ INSERT INTO vault (user_id, coll, id, data, updated_at)
        VALUES (${uid}, ${o.coll}, ${o.id}, ${JSON.stringify({ v: 1, iv: o.data.iv, ct: o.data.ct })}::jsonb, now())
        ON CONFLICT (user_id, coll, id) DO UPDATE SET data = excluded.data, updated_at = now()`);
  await sql.transaction(stmts);
  return stmts.length;
}

/* ---------- Limitation des tentatives ---------- */
export async function hit(key, limit, windowSec) {
  await schema();
  const r = await db()`/*q:rate_hit*/ INSERT INTO rate_limits (k, n, reset_at) VALUES (${key}, 1, now() + make_interval(secs => ${windowSec}))
    ON CONFLICT (k) DO UPDATE SET
      n = CASE WHEN rate_limits.reset_at < now() THEN 1 ELSE rate_limits.n + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < now() THEN now() + make_interval(secs => ${windowSec}) ELSE rate_limits.reset_at END
    RETURNING n`;
  return (r[0]?.n ?? 1) <= limit;
}

/* ---------- Anciennes données (version à mot de passe unique, non chiffrée) ---------- */
export async function legacyState() {
  const sql = db();
  const t = await sql`/*q:legacy_exists*/ SELECT to_regclass('public.docs') AS t`;
  if (!t[0]?.t) return null;
  const rows = await sql`/*q:legacy_select*/ SELECT coll, id, data FROM docs`;
  const state = { config: null };
  for (const c of COLLS) if (c !== "config") state[c] = [];
  for (const r of rows) {
    const data = parse(r.data);
    if (r.coll === "config") { if (r.id === "main") state.config = data; }
    else if (state[r.coll]) state[r.coll].push({ ...data, id: r.id });
  }
  return state;
}
export async function legacyDrop() {
  await db()`/*q:legacy_drop*/ DROP TABLE IF EXISTS docs`;
}
