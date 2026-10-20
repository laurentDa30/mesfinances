import { checkPassword, setSession, body, noStore } from "../lib/auth.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    if (!checkPassword(body(req).password)) {
      await new Promise(r => setTimeout(r, 800)); // ralentit les essais en série
      return res.status(401).json({ error: "Mot de passe incorrect." });
    }
    setSession(res);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
