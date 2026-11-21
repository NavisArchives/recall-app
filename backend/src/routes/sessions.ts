import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireDevice, requireArchive } from "../middleware/auth.js";
import { fail } from "../lib/errors.js";
import { isTrustedDisplay } from "../services/displayWriter.js";

export const sessionsRouter = Router();

/**
 * Measurement of Margaret's own use of her screen: when the display was
 * awake, which memory was open, and for how long.
 *
 * Only the display writes here. Someone signed in as an admin or co-author
 * is working on the archive, not living with it, and their browsing is
 * never recorded — the guard below is the one that enforces that.
 *
 * Resolved through the shared helper (M125/F39): a family-session member
 * used to read as nobody here, so a remote admin's browsing was recorded
 * into her engagement data as if the display had been watched. Measurement
 * of her use must not be polluted by people working on the archive.
 *
 * And it must come from her screen (access-7): "nobody signed in" on an
 * untrusted installation is a second laptop, not the display, so the test
 * is the trusted-display one, applied to every write here — the closing
 * writes too, which could otherwise end or rewrite her visits by id.
 */
const isDisplay = isTrustedDisplay;

sessionsRouter.post("/", requireDevice, async (req, res) => {
  if (!(await isDisplay(req))) return res.status(204).end();
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("device_sessions")
    .insert({ device_label: req.body?.device_label || "main-screen", archive_id: archive })
    .select("id, started_at")
    .single();

  if (error) return fail(res, 500, "The session could not be started.", error);
  res.status(201).json(data);
});

sessionsRouter.post("/:id/end", requireDevice, async (req, res) => {
  if (!(await isDisplay(req))) return res.status(204).end();
  // Scoped to the archive. Scoping to the *installation* would be tighter —
  // one screen in a household should not close another's session — but
  // `device_sessions` records no installation, so that needs a column first.
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: session } = await supabase
    .from("device_sessions")
    .select("id, started_at, ended_at")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (!session) return res.status(404).json({ error: "Session not found." });
  if (session.ended_at) return res.status(204).end();

  const endedAt = new Date();
  const duration = Math.max(
    0,
    Math.round((endedAt.getTime() - new Date(session.started_at).getTime()) / 1000)
  );

  const { error } = await supabase
    .from("device_sessions")
    .update({ ended_at: endedAt.toISOString(), duration_seconds: duration })
    .eq("id", session.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The session could not be closed.", error);

  // Any visit still open when the screen sleeps is closed with it.
  await supabase
    .from("channel_visits")
    .update({ ended_at: endedAt.toISOString() })
    .eq("device_session_id", session.id)
    .eq("archive_id", archive)
    .is("ended_at", null);

  res.status(204).end();
});

sessionsRouter.post("/visits", requireDevice, async (req, res) => {
  if (!(await isDisplay(req))) return res.status(204).end();
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { device_session_id, channel_id, channel_number, entry_method } = req.body ?? {};
  const number = Number(channel_number);

  if (!Number.isInteger(number)) {
    return res.status(400).json({ error: "Invalid channel number." });
  }

  const { data, error } = await supabase
    .from("channel_visits")
    .insert({
      device_session_id: device_session_id || null,
      channel_id: channel_id || null,
      channel_number: number,
      entry_method: ["keyboard", "nfc", "overview", "direct"].includes(entry_method)
        ? entry_method
        : "keyboard",
      archive_id: archive,
    })
    .select("id, started_at")
    .single();

  if (error) return fail(res, 500, "The visit could not be recorded.", error);
  res.status(201).json(data);
});

/**
 * Closes a visit. Called on leaving the channel and, as a safety net, by a
 * heartbeat — so a visit that ends with the power being cut still has a
 * duration close to the truth rather than none at all.
 */
sessionsRouter.post("/visits/:id/end", requireDevice, async (req, res) => {
  if (!(await isDisplay(req))) return res.status(204).end();
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: visit } = await supabase
    .from("channel_visits")
    .select("id, started_at")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (!visit) return res.status(404).json({ error: "Visit not found." });

  const endedAt = new Date();
  const duration = Math.max(
    0,
    Math.round((endedAt.getTime() - new Date(visit.started_at).getTime()) / 1000)
  );
  const viewed = Number(req.body?.media_viewed_count);

  const { error } = await supabase
    .from("channel_visits")
    .update({
      ended_at: endedAt.toISOString(),
      duration_seconds: duration,
      ...(Number.isInteger(viewed) && viewed >= 0 ? { media_viewed_count: viewed } : {}),
    })
    .eq("id", visit.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The visit could not be closed.", error);
  res.status(204).end();
});
