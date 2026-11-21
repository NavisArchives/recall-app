import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { evaluateAll, healthFrom, RULE_SUMMARY, type RuleKey } from "../services/suggestions.js";
import { fail } from "../lib/errors.js";
import { channelScope } from "../services/channelVisibility.js";

export const suggestionsRouter = Router();

const SELECT =
  "id, channel_id, rule_key, message, severity, resolved, created_at, channel:channels!suggestions_channel_id_fkey(id, number, title)";

/**
 * Everything the archive is currently missing, plus the two things the
 * sidebar shows: the short "needs attention" list.
 *
 * `health` is still computed and still returned, and nothing renders it
 * (M63). The percentage was removed from both overviews because a score is a
 * verdict — a family two days in met a red 32% on their mother's archive. It
 * stays in the payload deliberately rather than being deleted: the owner has
 * an open choice between dropping the number for good and reframing it as
 * progress ("3 of 10 channels ready for her screen"), and the second costs
 * nothing while this ratio still exists. If he settles on dropping it, this
 * and `healthFrom` go together.
 * Recomputed on every read — at this scale that costs less than reasoning
 * about when a stale figure would be wrong.
 */
suggestionsRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  try {
    await evaluateAll(archive);
  } catch (err) {
    console.error("[suggestions] refresh failed, serving stored rows:", err);
  }

  const { data, error } = await supabase
    .from("suggestions")
    .select(SELECT)
    .eq("archive_id", archive)
    .eq("resolved", false)
    .order("severity")
    .order("created_at");

  if (error) return fail(res, 500, "The archive check could not be loaded.", error);

  /*
    Every suggestion is about one channel and quotes its label, so a co-author
    is told only about channels they may read (access-1). The groups and the
    ratio are computed from the same filtered list, so the counts never
    disclose a gap on a shelf this reader is not shown.
  */
  let scope;
  try {
    scope = await channelScope(archive, req.profile ?? null, false);
  } catch (err) {
    return fail(res, 500, "The archive check could not be loaded.", err);
  }
  const open = (data ?? []).filter((row) => scope.allows(row.channel_id as string | null));
  const counts = new Map<RuleKey, number>();
  for (const row of open) {
    const key = row.rule_key as RuleKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groups = [...counts.entries()]
    .filter(([key]) => key in RULE_SUMMARY)
    .map(([key, count]) => ({ rule_key: key, count, label: RULE_SUMMARY[key](count) }))
    .sort((a, b) => b.count - a.count);

  res.json({ items: open, groups, health: healthFrom(open) });
});
