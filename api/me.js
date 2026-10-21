import { requireUser, noStore } from "../lib/auth.js";

export default async function handler(req, res) {
  noStore(res);
  try {
    const u = await requireUser(req, res); if (!u) return;
    return res.status(200).json({ ok: true, email: u.email });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
