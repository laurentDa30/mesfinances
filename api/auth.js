import crypto from "node:crypto";
import { body, noStore, clientIp, setSession, clearSession, requireUser, hashSecret, checkSecret } from "../lib/auth.js";
import { findUserByEmail, createUser, setPassword, setRecovery, deleteUser, hit, legacyState, legacyDrop } from "../lib/db.js";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const normEmail = e => String(e || "").trim().toLowerCase();
const isHash = h => typeof h === "string" && h.length >= 40 && h.length <= 120;
const isBox = b => b && b.v === 1 && typeof b.iv === "string" && typeof b.ct === "string" && b.iv.length <= 32 && b.ct.length <= 200;
const slow = () => new Promise(r => setTimeout(r, 400 + Math.random() * 300));
const fail = (res, code, msg) => res.status(code).json({ error: msg });

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return fail(res, 405, "method");
  const b = body(req), ip = clientIp(req), action = b.action;
  try {
    switch (action) {
      case "signup": {
        if (b.hp) return fail(res, 400, "Inscription refusée.");                 // champ piège anti-robots
        if (!b.consent) return fail(res, 400, "Accepte la politique de confidentialité pour continuer.");
        const email = normEmail(b.email);
        if (!EMAIL_RE.test(email)) return fail(res, 400, "Adresse e-mail invalide.");
        if (!isHash(b.auth) || !isHash(b.recoveryAuth) || !isBox(b.protectedKey) || !isBox(b.recoveryKey)) return fail(res, 400, "Données d'inscription invalides.");
        if (!(await hit("signup:" + ip, 5, 3600))) return fail(res, 429, "Trop d'inscriptions depuis ce réseau. Réessaie dans une heure.");
        const u = await createUser({ email, auth_hash: hashSecret(b.auth), recovery_hash: hashSecret(b.recoveryAuth), protected_key: b.protectedKey, recovery_key: b.recoveryKey });
        if (!u) return fail(res, 409, "Un compte existe déjà avec cette adresse.");
        setSession(res, u.id, u.session_ver);
        return res.status(200).json({ ok: true });
      }
      case "login": {
        const email = normEmail(b.email);
        if (!(await hit("login-ip:" + ip, 30, 900)) || !(await hit("login:" + email, 8, 900))) return fail(res, 429, "Trop de tentatives. Réessaie dans 15 minutes.");
        const u = EMAIL_RE.test(email) ? await findUserByEmail(email) : null;
        const ok = checkSecret(b.auth, u?.auth_hash);                         // calcul identique si le compte n'existe pas
        if (!u || !ok) { await slow(); return fail(res, 401, "E-mail ou mot de passe incorrect."); }
        setSession(res, u.id, u.session_ver);
        return res.status(200).json({ ok: true, protectedKey: u.protected_key });
      }
      case "logout": {
        clearSession(res);
        return res.status(200).json({ ok: true });
      }
      case "key": {
        const u = await requireUser(req, res); if (!u) return;
        return res.status(200).json({ email: u.email, protectedKey: u.protected_key });
      }
      case "password": {
        const u = await requireUser(req, res); if (!u) return;
        if (!(await hit("pwd:" + u.id, 10, 3600))) return fail(res, 429, "Trop de tentatives. Réessaie plus tard.");
        if (!checkSecret(b.auth, u.auth_hash)) { await slow(); return fail(res, 401, "Mot de passe actuel incorrect."); }
        if (!isHash(b.newAuth) || !isBox(b.newProtectedKey)) return fail(res, 400, "Données invalides.");
        const sv = await setPassword(u.id, hashSecret(b.newAuth), b.newProtectedKey);
        setSession(res, u.id, sv);                                              // les autres appareils sont déconnectés
        return res.status(200).json({ ok: true });
      }
      case "recovery-start":
      case "recovery-finish": {
        const email = normEmail(b.email);
        if (!(await hit("rec-ip:" + ip, 10, 3600)) || !(await hit("rec:" + email, 5, 3600))) return fail(res, 429, "Trop de tentatives. Réessaie dans une heure.");
        const u = EMAIL_RE.test(email) ? await findUserByEmail(email) : null;
        const ok = checkSecret(b.recoveryAuth, u?.recovery_hash);
        if (!u || !ok) { await slow(); return fail(res, 401, "E-mail ou clé de secours incorrects."); }
        if (action === "recovery-start") return res.status(200).json({ recoveryKey: u.recovery_key });
        if (!isHash(b.newAuth) || !isBox(b.newProtectedKey)) return fail(res, 400, "Données invalides.");
        const sv = await setPassword(u.id, hashSecret(b.newAuth), b.newProtectedKey);
        setSession(res, u.id, sv);
        return res.status(200).json({ ok: true });
      }
      case "recovery-rotate": {
        const u = await requireUser(req, res); if (!u) return;
        if (!checkSecret(b.auth, u.auth_hash)) { await slow(); return fail(res, 401, "Mot de passe incorrect."); }
        if (!isHash(b.newRecoveryAuth) || !isBox(b.newRecoveryKey)) return fail(res, 400, "Données invalides.");
        await setRecovery(u.id, hashSecret(b.newRecoveryAuth), b.newRecoveryKey);
        return res.status(200).json({ ok: true });
      }
      case "delete": {
        const u = await requireUser(req, res); if (!u) return;
        if (!checkSecret(b.auth, u.auth_hash)) { await slow(); return fail(res, 401, "Mot de passe incorrect."); }
        await deleteUser(u.id);
        clearSession(res);
        return res.status(200).json({ ok: true });
      }
      case "legacy":
      case "legacy-drop": {
        // Récupération unique des données de l'ancienne version (mot de passe APP_PASSWORD, données non chiffrées)
        const u = await requireUser(req, res); if (!u) return;
        const expected = process.env.APP_PASSWORD;
        if (!expected) return fail(res, 404, "Aucune ancienne donnée à récupérer.");
        if (!(await hit("legacy:" + u.id, 5, 3600))) return fail(res, 429, "Trop de tentatives.");
        const a = crypto.createHash("sha256").update(String(b.password ?? "")).digest(), e = crypto.createHash("sha256").update(expected).digest();
        if (!crypto.timingSafeEqual(a, e)) { await slow(); return fail(res, 401, "Ancien mot de passe incorrect."); }
        if (action === "legacy-drop") { await legacyDrop(); return res.status(200).json({ ok: true }); }
        const state = await legacyState();
        if (!state) return fail(res, 404, "Aucune ancienne donnée à récupérer.");
        return res.status(200).json({ state });
      }
      default:
        return fail(res, 400, "Action inconnue.");
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
