import { Router } from "express";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { activityStream } from "../services/streams.js";
import { fail } from "../lib/errors.js";
import { channelScope } from "../services/channelVisibility.js";

export const activityRouter = Router();

/**
 * What has happened in this archive lately. The sidebar takes the newest
 * three; /admin/activity asks for the lot. The rows come from
 * `activityStream` (M103) — the same function the streams API serves — and
 * this route keeps its original shape: a plain array.
 */
activityRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const limit = Math.min(Number(req.query.limit) || 100, 200);

  try {
    // A line naming a channel this reader cannot see is left out (access-1).
    const scope = await channelScope(archive, req.profile ?? null, false);
    const { events } = await activityStream(archive, scope, limit);
    res.json(events);
  } catch (err) {
    fail(res, 500, "The activity log could not be loaded.", err);
  }
});
