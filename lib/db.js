import { neon } from "@neondatabase/serverless";

export const COLLS = ["config", "recurring", "ops", "accounts", "projects", "banks"];
const ID_RE = /^[A-Za-z0-9_\-.:]{1,80}$/;
const MAX_DOC = 64 * 1024;
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

// Une seule table : chaque document de l'app (une charge, une opération, un livret…) est une ligne JSON.
function ensureSchema() {
  if (!_schema) {
    const sql = db();
    _schema = sql`CREATE TABLE IF NOT EXISTS docs (
      coll text NOT NULL,
      id text NOT NULL,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (coll, id)
    )`.catch(e => { _schema = null; throw e; });
  }
  return _schema;
}

export async function getState() {
  await ensureSchema();
  const rows = await db()`SELECT coll, id, data FROM docs`;
  const state = { config: null };
  for (const c of COLLS) if (c !== "config") state[c] = [];
  for (const r of rows) {
    const data = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
    if (r.coll === "config") { if (r.id === "main") state.config = data; }
    else if (state[r.coll]) state[r.coll].push({ ...data, id: r.id });
  }
  return state;
}

export function validateOps(ops) {
  if (!Array.isArray(ops)) return "ops doit être une liste";
  if (ops.length > MAX_OPS) return `trop d'opérations (max ${MAX_OPS})`;
  for (const o of ops) {
    if (!o || (o.op !== "put" && o.op !== "del")) return "op inconnue";
    if (!COLLS.includes(o.coll)) return "collection inconnue";
    if (typeof o.id !== "string" || !ID_RE.test(o.id)) return "identifiant invalide";
    if (o.op === "put") {
      if (!o.data || typeof o.data !== "object" || Array.isArray(o.data)) return "document invalide";
      if (JSON.stringify(o.data).length > MAX_DOC) return "document trop gros";
    }
  }
  return null;
}

export async function applyOps(ops) {
  if (!ops.length) return 0;
  await ensureSchema();
  const sql = db();
  const stmts = ops.map(o => {
    if (o.op === "del") return sql`DELETE FROM docs WHERE coll = ${o.coll} AND id = ${o.id}`;
    const { id, ...data } = o.data;
    return sql`INSERT INTO docs (coll, id, data, updated_at)
      VALUES (${o.coll}, ${o.id}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (coll, id) DO UPDATE SET data = excluded.data, updated_at = now()`;
  });
  await sql.transaction(stmts);
  return stmts.length;
}
