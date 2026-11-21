import { Router } from "express";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { fail } from "../lib/errors.js";
import { channelScope, type ChannelScope } from "../services/channelVisibility.js";
import {
  activityStream,
  contentStream,
  deviceStream,
  engagementStream,
  isEngagementRange,
  missionsStream,
  nfcStream,
  peopleStream,
  subjectStream,
} from "../services/streams.js";

export const streamsRouter = Router();

/**
 * M103 — thin wrappers, nothing more. The facts live in
 * `services/streams.ts`; these routes authenticate, scope, call, and answer.
 * A new consumer that can import the service should; a consumer on the other
 * side of HTTP reads these.
 */
/*
  Each takes the reader's channel scope (access-1), resolved once per request.
  The subject and device streams name no channel and ignore it.
*/
const STREAMS: Record<string, (archive: string, scope: ChannelScope) => Promise<unknown>> = {
  subject: (archive) => subjectStream(archive),
  content: contentStream,
  people: peopleStream,
  nfc: nfcStream,
  missions: missionsStream,
  activity: (archive, scope) => activityStream(archive, scope),
  device: (archive) => deviceStream(archive),
};

/**
 * Engagement is the one stream that takes a window (M115 strand 3):
 * `?range=today|week|month`, defaulting to the week. An unknown range is
 * refused in words rather than silently answered with the default — three
 * tabs quietly returning the same data is the exact lie this exists to end.
 */
streamsRouter.get("/engagement", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const range = req.query.range ?? "week";
  if (!isEngagementRange(range)) {
    return res.status(400).json({ error: "The range must be today, week or month." });
  }

  try {
    const scope = await channelScope(archive, req.profile ?? null, false);
    res.json(await engagementStream(archive, scope, range));
  } catch (err) {
    fail(res, 500, "That could not be read right now.", err);
  }
});

for (const [name, stream] of Object.entries(STREAMS)) {
  streamsRouter.get(`/${name}`, requireRole(CAN_WRITE_CONTENT), async (req, res) => {
    const archive = requireArchive(req, res);
    if (!archive) return;
    try {
      res.json(await stream(archive, await channelScope(archive, req.profile ?? null, false)));
    } catch (err) {
      fail(res, 500, "That could not be read right now.", err);
    }
  });
}
