import { requireAuth, noStore } from "../lib/auth.js";
import { getState } from "../lib/db.js";

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "GET") return res.status(405).json({ error: "method" });
  try {
    if (!requireAuth(req, res)) return;
    return res.status(200).json(await getState());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
