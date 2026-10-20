import crypto from "node:crypto";

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

export function verify(req) {
  const tok = parseCookies(req.headers.cookie)[COOKIE];
  if (!tok) return false;
  const [p, s] = tok.split(".");
  if (!p || !s) return false;
  const want = sign(p);
  if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return false;
  try { return JSON.parse(Buffer.from(p, "base64url").toString()).exp > Date.now(); } catch { return false; }
}

export function checkPassword(pw) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new Error("APP_PASSWORD manquant dans les variables d'environnement Vercel.");
  const a = crypto.createHash("sha256").update(String(pw ?? "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function setSession(res) {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${p}.${sign(p)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

export function requireAuth(req, res) {
  if (verify(req)) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}

export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}

export function noStore(res) { res.setHeader("Cache-Control", "no-store"); }
