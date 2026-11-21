import { Router } from "express";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { searchArchive } from "../services/archiveSearch.js";
import { fail } from "../lib/errors.js";

export const searchRouter = Router();

/**
 * M104 — one read-only retrieval root. Text in (typed or spoken; the
 * microphone is speech-to-text at the edge, so both arrive as the same
 * query), matching archive content out, with provenance. Never a write,
 * never a navigation, never a change to her screen.
 */
searchRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) return res.status(400).json({ error: "Ask something to search for." });
  if (q.length > 500) return res.status(400).json({ error: "That question is too long." });

  try {
    res.json(await searchArchive(archive, q, req.profile!));
  } catch (err) {
    fail(res, 500, "The archive could not be searched right now.", err);
  }
});
