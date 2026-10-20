import { verify, noStore } from "../lib/auth.js";

export default function handler(req, res) {
  noStore(res);
  try {
    return verify(req) ? res.status(200).json({ ok: true }) : res.status(401).json({ error: "unauthorized" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
