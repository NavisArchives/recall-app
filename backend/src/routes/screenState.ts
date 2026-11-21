import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireDevice, requireArchive, readDevice } from "../middleware/auth.js";
import { screenNow } from "../services/streams.js";
import { fail } from "../lib/errors.js";
import { isTrustedDisplay } from "../services/displayWriter.js";

export const screenStateRouter = Router();

/**
 * What Margaret's screen is showing right now.
 *
 * The display reports it as each channel opens; the dashboard polls it to
 * mark one shelf card ON SCREEN. Reported by the trusted machine rather
 * than a signed-in person — nobody is signed in at her screen.
 */
screenStateRouter.get("/", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  // The liveness rule ("on" only while watched, silent after five minutes)
  // lives in `screenNow` since M103, shared with the subject and device
  // streams — one rule, wherever "on screen" is said.
  try {
    const screen = await screenNow(archive);
    res.json({
      live: screen.live,
      current_channel_number: screen.channel_number,
      // Which photograph is up (040) — null together when not reported,
      // and always null while the screen is not live.
      photo_index: screen.photo_index,
      photo_count: screen.photo_count,
      screen_synced_at: screen.synced_at,
      last_channel_number: screen.last_channel_number,
      last_seen_at: screen.last_seen_at,
      // The display's own label, for the pre-auth pill (M146).
      display_name: screen.display_name,
    });
  } catch (err) {
    fail(res, 500, "The screen state could not be read.", err);
  }
});

/*
  Only her screen reports what her screen shows (access-7). A member's phone
  or a second laptop passes `requireDevice` too, and used to be able to move
  the dashboard's ON SCREEN marker and version another machine's row. Anyone
  else is answered 204 and nothing is written — the same quiet refusal the
  session routes give, because every caller treats this report as
  fire-and-forget and an admin previewing a channel is not an error.
*/
screenStateRouter.post("/", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  if (!(await isTrustedDisplay(req))) return res.status(204).end();
  const raw = req.body?.number;
  const number = raw === null ? null : Number(raw);

  if (number !== null && (!Number.isInteger(number) || number < 0 || number > 99)) {
    return res.status(400).json({ error: "Invalid channel number." });
  }

  /*
    The photo position (040). Optional and paired: the display sends
    `photo_index`/`photo_count` as it advances, or neither. One without the
    other, an index outside the count, or a non-integer is a malformed
    report and refused — the database's coherence constraint would refuse
    it anyway, but a 400 names the caller's mistake where a 500 would hide
    it. Absent fields clear the position: a report that only names a channel
    means "position unknown", never "still photo 4" — the stale answer is
    worse than none.
  */
  const rawIndex = req.body?.photo_index;
  const rawCount = req.body?.photo_count;
  const hasPosition = rawIndex !== undefined && rawIndex !== null;
  const hasCount = rawCount !== undefined && rawCount !== null;
  if (hasPosition !== hasCount) {
    return res.status(400).json({ error: "Photo position needs both index and count." });
  }
  const photoIndex = hasPosition ? Number(rawIndex) : null;
  const photoCount = hasCount ? Number(rawCount) : null;
  if (
    photoIndex !== null &&
    photoCount !== null &&
    (!Number.isInteger(photoIndex) ||
      !Number.isInteger(photoCount) ||
      photoIndex < 0 ||
      photoCount < 1 ||
      photoIndex >= photoCount)
  ) {
    return res.status(400).json({ error: "Photo position must sit inside its count." });
  }

  const { error } = await supabase
    .from("settings")
    .update({
      current_channel_number: number,
      current_photo_index: photoIndex,
      current_photo_count: photoCount,
      screen_synced_at: new Date().toISOString(),
    })
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The screen state could not be saved.", error);

  /*
    The build this machine is running (041), reported on the same contact.

    There is no separate heartbeat — this write *is* how a display touches
    the backend, so it is the honest check-in. The version is written to the
    one installation the device cookie names, scoped by archive as well: the
    id alone is already a signed claim, but a query that can say which family
    it means, says so. A device can therefore only ever version itself, never
    another household's screen.

    Deliberately not fatal. A screen that reports a position but fails to
    record its version has still told the truth about what it is showing —
    refusing the whole write would trade the fact the family needs for the
    fact only the diagnostics want.
  */
  const rawVersion = req.body?.software_version;
  if (typeof rawVersion === "string") {
    const version = rawVersion.trim().slice(0, 40);
    if (version) {
      const device = readDevice(req);
      if (device) {
        await supabase
          .from("installations")
          .update({ software_version: version })
          .eq("id", device.installationId)
          .eq("archive_id", archive);
      }
    }
  }

  res.status(204).end();
});
