import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { engagementStream, isEngagementRange } from "../services/streams.js";
import { fail } from "../lib/errors.js";
import { channelScope } from "../services/channelVisibility.js";

export const insightsRouter = Router();

/**
 * What the archive can say about how it is used.
 *
 * Deliberately descriptive: how long the screen was awake, which memories
 * were opened, which were not. Nothing here scores Margaret, and nothing
 * is inferred beyond what was measured — a channel nobody opened is quiet,
 * not forgotten.
 *
 * Since M103 the arithmetic lives in `engagementStream` — one fact, one
 * source, shared with the streams API and whatever reads it next. This
 * route keeps its original response shape so its consumers never noticed
 * the move; only the computation's address changed.
 */
insightsRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  // M115 strand 3: the route honours ?range, so Today / This week / This
  // month stop being three tabs over one answer. Unknown ranges are refused
  // in words — a silent fallback would be the same lie in a quieter voice.
  const range = req.query.range ?? "week";
  if (!isEngagementRange(range)) {
    return res.status(400).json({ error: "The range must be today, week or month." });
  }

  try {
    // Only channels this reader may see are named (access-1).
    const scope = await channelScope(archive, req.profile ?? null, false);
    const engagement = await engagementStream(archive, scope, range);

    res.json({
      range: engagement.window.range,
      window: engagement.window,
      most_visited: engagement.per_channel.slice(0, 5),
      quiet: engagement.quiet,
      entry_methods: engagement.entry_methods,
      has_data: engagement.has_data,
    });
  } catch (err) {
    fail(res, 500, "Usage data is unavailable.", err);
  }
});

/** Kept separate from the read above so a failure there is obvious. */
insightsRouter.get("/health", requireRole(CAN_WRITE_CONTENT), async (_req, res) => {
  const { error } = await supabase.from("device_sessions").select("id").limit(1);
  if (error) return fail(res, 500, "Usage data is unavailable.", error);
  res.json({ ok: true });
});
