import { clearSession, noStore } from "../lib/auth.js";

export default function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  clearSession(res);
  return res.status(200).json({ ok: true });
}
