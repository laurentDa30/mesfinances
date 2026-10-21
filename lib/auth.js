import crypto from "node:crypto";
import { findUserById } from "./db.js";

const COOKIE = "cf_session";
const MAX_AGE = 180 * 24 * 3600; // 6 mois

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET manquante ou trop courte (32 caractères minimum).");
  return s;
}
const sign = p => crypto.createHmac("sha256", secret()).update(p).digest("base64url");

function parseCookies(h) {
  const out = {};
  String(h || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* ---------- Session : cookie signé { uid, sv, exp } ---------- */
export function setSession(res, uid, sv) {
  const p = Buffer.from(JSON.stringify({ uid, sv, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${p}.${sign(p)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
export function readSession(req) {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  if (!tok) return null;
  const [p, s] = tok.split(".");
  if (!p || !s) return null;
  const want = sign(p);
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, "base64url").toString());
    return d.exp > Date.now() && d.uid ? d : null;
  } catch { return null; }
}
// Renvoie l'utilisateur connecté, ou répond 401. Un changement de mot de passe invalide les anciennes sessions.
export async function requireUser(req, res) {
  const s = readSession(req);
  const u = s ? await findUserById(s.uid) : null;
  if (!u || u.session_ver !== s.sv) { res.status(401).json({ error: "unauthorized" }); return null; }
  return u;
}

/* ---------- Secrets : le serveur ne reçoit qu'une empreinte dérivée du mot de passe, qu'il re-hache ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
export function hashSecret(s) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(s), salt, 32, SCRYPT);
  return `s1$${salt.toString("base64")}$${h.toString("base64")}`;
}
export function checkSecret(s, stored) {
  const [v, sa, h] = String(stored || "").split("$");
  const salt = v === "s1" && sa ? Buffer.from(sa, "base64") : Buffer.alloc(16);
  const calc = crypto.scryptSync(String(s ?? ""), salt, 32, SCRYPT);
  const hb = v === "s1" && h ? Buffer.from(h, "base64") : Buffer.alloc(32);
  return v === "s1" && hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}

export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
export function noStore(res) { res.setHeader("Cache-Control", "no-store"); }
export function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
}
