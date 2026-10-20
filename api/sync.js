import { requireAuth, body, noStore } from "../lib/auth.js";
import { validateOps, applyOps } from "../lib/db.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  try {
    if (!requireAuth(req, res)) return;
    const ops = body(req).ops;
    const err = validateOps(ops);
    if (err) return res.status(400).json({ error: err });
    const applied = await applyOps(ops);
    return res.status(200).json({ ok: true, applied });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
