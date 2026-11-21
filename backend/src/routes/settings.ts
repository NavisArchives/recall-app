import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { actingProfile, requireRole, requireDevice, requireArchive } from "../middleware/auth.js";
import { CAN_MANAGE_PEOPLE, CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import {
  PROFILE_PICTURES_BUCKET,
  buildStoragePath,
  uploadToBucket,
  verifyFile,
} from "../services/media.js";
import { readUpload, upload, uploadGate } from "../middleware/upload.js";
import { fail } from "../lib/errors.js";
import { maybeNotifyRenewal, renewScreen } from "../services/deviceSession.js";
import {
  CONSENT_COLUMNS,
  FAMILY_SCREEN_COLUMNS,
  SETTINGS_ADMIN_COLUMNS,
  SETTINGS_DISPLAY_COLUMNS,
  SETTINGS_MEMBER_COLUMNS,
} from "../services/dto.js";
import { logActivity, actorName } from "../services/activityLog.js";
import { CONSENT_TEXT_VERSION, parseConsent, recordConsent } from "../services/consent.js";

export const settingsRouter = Router();

/*
  What the PUT below may write. What the GET returns is decided per request
  by who is asking (SETTINGS_*_COLUMNS in dto.ts): the comment that used to
  sit here said this GET was "admin-gated", and it was not — it sits behind
  requireDevice, and her screen was being sent the postal address (053), her
  birth date and the note on every load. Found by the launch sweep.
*/
const COLUMNS = SETTINGS_ADMIN_COLUMNS;

/**
 * Whose archive this is, for the activity log (M120/F35).
 *
 * These lines used to say "Margaret's profile" in every family's log,
 * because the first archive's subject was written into the sentence as a
 * constant. Every family that has joined since read another household's
 * name in their own history. The subject is a row in *their* archive; the
 * log asks the row.
 *
 * "the subject" is the fallback rather than any name — a log line that
 * cannot name the person should say so, not guess.
 */
async function subjectPossessive(archive: string): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("display_name, full_name")
    .eq("archive_id", archive)
    .maybeSingle();
  const name = (data?.full_name || data?.display_name || "").trim();
  return name ? `${name}'s` : "the subject's";
}

/** The person the archive is for. Shown at the top of every admin view. */
settingsRouter.get("/", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  // Same shape as /people: the display, a member, or someone who manages
  // people — three column sets, chosen before the query is issued so the
  // address never leaves the database for a screen that has no use for it.
  const profile = await actingProfile(req);
  const canManage = !!profile && CAN_MANAGE_PEOPLE.includes(profile.role);
  /*
    Her own profile is the display, not a member (access-8). Pairing gives
    the screen the subject's `user` profile, so "somebody is acting" was true
    on the one machine the display set exists for, and her screen was served
    her birth date, her residence and the note on every load. A `user`
    profile opens only on the trusted screen (auth.ts unlock), so reading it
    as the display is exact.
  */
  const isMember = !!profile && profile.role !== "user";
  // Typed as a plain string on purpose: supabase-js parses a literal column
  // list into a row type, and a union of three lists parses into an error.
  const columns: string = canManage
    ? SETTINGS_ADMIN_COLUMNS
    : isMember
      ? SETTINGS_MEMBER_COLUMNS
      : SETTINGS_DISPLAY_COLUMNS;

  const { data, error } = await supabase
    .from("settings")
    .select(columns)
    .eq("archive_id", archive)
    .maybeSingle<Record<string, unknown> & { photo_path?: string | null }>();

  if (error) return fail(res, 500, "The profile could not be loaded.", error);
  if (!data) return res.json(null);

  /*
    When this archive was opened — the provenance line the printed postcard
    carries ("A NEW ARCHIVE, OPENED FOR YOU · JANUARY 2025", 23a). Read from
    the archive's own row so the card never invents a month; a failed read
    returns null and the card simply omits the block.
  */
  const { data: archiveRow } = await supabase
    .from("archives")
    .select("created_at")
    .eq("id", archive)
    .maybeSingle();

  const { photo_path, ...rest } = data;
  res.json({
    ...rest,
    photo_url: photo_path ? `${env.publicUrl}/api/media/subject/photo` : null,
    archive_since: archiveRow?.created_at ?? null,
  });
});

settingsRouter.put("/", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const {
    display_name,
    full_name,
    birth_date,
    residence,
    delivery_address,
    note,
  } = req.body;

  if (display_name !== undefined && (typeof display_name !== "string" || !display_name.trim())) {
    return res.status(400).json({ error: "The display name is required." });
  }

  const { data, error } = await supabase
    .from("settings")
    .update({
      ...(display_name !== undefined && { display_name: display_name.trim() }),
      ...(full_name !== undefined && { full_name: full_name || null }),
      ...(birth_date !== undefined && { birth_date: birth_date || null }),
      ...(residence !== undefined && { residence: residence || null }),
      ...(delivery_address !== undefined && { delivery_address: delivery_address || null }),
      ...(note !== undefined && { note: note || null }),
      updated_at: new Date().toISOString(),
    })
    .eq("archive_id", archive)
    .select(COLUMNS)
    .single();

  if (error) return fail(res, 500, "The profile could not be saved.", error);

  // The row we just wrote already carries the name — no second query.
  const whose = (data.full_name || data.display_name || "").trim();
  logActivity(
    req.profile,
    "profile_edited",
    `${actorName(req.profile)} updated ${whose ? `${whose}'s` : "the subject's"} profile`
  );

  const { photo_path, ...rest } = data;
  res.json({ ...rest, photo_url: photo_path ? `${env.publicUrl}/api/media/subject/photo` : null });
});

/*
 * Her word (054) — the declaration the archive rests on, for the people who
 * manage it. Admin-gated on purpose: the display has no use for it, and a
 * co-author is not the person who signed.
 */
settingsRouter.get("/consent", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const [{ data: current, error }, { count }] = await Promise.all([
    supabase
      .from("archive_consents")
      .select(CONSENT_COLUMNS)
      .eq("archive_id", archive)
      .is("withdrawn_at", null)
      .order("declared_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("archive_consents")
      .select("id", { count: "exact", head: true })
      .eq("archive_id", archive),
  ]);
  if (error) return fail(res, 500, "The declaration could not be read.", error);
  res.json({ current: current ?? null, declarations: count ?? 0, text_version: CONSENT_TEXT_VERSION });
});

/** Record it (again): a new row, the old one stays as history. */
settingsRouter.post("/consent", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const consent = parseConsent(req.body);
  if (!consent) return res.status(400).json({ error: "Say who agrees, and who signs." });

  const { data: subject } = await supabase
    .from("settings")
    .select("display_name, full_name")
    .eq("archive_id", archive)
    .maybeSingle();
  const subjectName = (subject?.full_name || subject?.display_name || "").trim() || "the subject";

  const { error } = await recordConsent({
    archive_id: archive,
    declared_by: req.profile?.personId ?? null,
    subject_name: subjectName,
    signer_relationship:
      typeof req.body?.signer_relationship === "string" ? req.body.signer_relationship.trim() || null : null,
    consent,
  });
  if (error) return fail(res, 500, "The declaration could not be recorded.", error);

  logActivity(
    req.profile,
    "consent_recorded",
    `${actorName(req.profile)} recorded who agrees to ${subjectName}'s archive (${consent.basis})`
  );
  res.status(201).json({ ok: true });
});

/** Withdraw the standing declaration. The row stays; withdrawn_at says when. */
settingsRouter.post("/consent/withdraw", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) || null : null;

  const { error } = await supabase
    .from("archive_consents")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: reason })
    .eq("archive_id", archive)
    .is("withdrawn_at", null);
  if (error) return fail(res, 500, "The declaration could not be withdrawn.", error);

  logActivity(req.profile, "consent_withdrawn", `${actorName(req.profile)} withdrew the consent declaration`);
  res.json({ ok: true });
});

/**
 * How the app sends mail, for the settings page to show. The address only —
 * the App Password never leaves the server.
 */
settingsRouter.get("/email", requireRole(CAN_WRITE_CONTENT), (_req, res) => {
  res.json({ from: env.emailFrom || null, configured: !!(env.emailUser && env.emailPass) });
});

/** Replaces the subject's photo, shown on her profile and the admin card. */
settingsRouter.post(
  "/photo",
  requireRole(CAN_MANAGE_PEOPLE),
  uploadGate,
  upload.single("photo"),
  async (req, res) => {
    const archive = requireArchive(req, res);
    if (!archive) return;
    if (!req.file) return res.status(400).json({ error: "No photo was provided." });

    const verified = await verifyFile(await readUpload(req.file), "image");
    if (!verified) {
      return res.status(400).json({ error: "That image format is not supported." });
    }

    const photo_path = buildStoragePath("subject", verified.extension);
    try {
      await uploadToBucket(PROFILE_PICTURES_BUCKET, photo_path, verified);
    } catch (err) {
      return fail(res, 500, "The photo could not be uploaded.", err);
    }

    const { error } = await supabase
      .from("settings")
      .update({ photo_path, updated_at: new Date().toISOString() })
      .eq("archive_id", archive);

    if (error) return fail(res, 500, "The photo could not be saved.", error);

    logActivity(
      req.profile,
      "profile_edited",
      `${actorName(req.profile)} changed ${await subjectPossessive(archive)} photo`
    );
    res.json({ photo_url: photo_path ? `${env.publicUrl}/api/media/subject/photo` : null });
  }
);

// ─────────────────────────────────────────── the screens in the house (047)

/**
 * Which machines are this family's screens.
 *
 * The question "which device is the display?" had no answer anywhere in the
 * product. Settings could sign *this* browser out and that was all — so a
 * family with a screen somewhere in the house could not see that it existed,
 * when it was last used, or what it was running, and a family whose screen
 * had been retired could not tell that from a screen that was merely asleep.
 *
 * Two kinds come back and the difference is the point (047). A **Recall
 * device** is hardware this project ships; the family cannot retire it and
 * it does not hold their browser-screen slot. A **browser screen** is a
 * machine they paired themselves, and it is theirs to retire.
 *
 * Admin only, like the rest of Settings, and archive-scoped like everything
 * else — a screen belongs to exactly one household.
 */
settingsRouter.get("/screens", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  interface ScreenRow {
    id: string;
    name: string;
    is_trusted: boolean;
    is_recall_device: boolean;
    trusted_at: string | null;
    last_used_at: string | null;
    software_version: string | null;
    session_expires_at: string | null;
    renewal_notified_at: string | null;
  }
  const { data, error } = await supabase
    .from("installations")
    .select(FAMILY_SCREEN_COLUMNS as string)
    .eq("archive_id", archive)
    .eq("is_trusted", true)
    .order("trusted_at", { ascending: true })
    .returns<ScreenRow[]>();

  /*
    A failed read is a failure, not an empty house (M221).

    Answering 200 with `[]` here would tell a family that nothing is paired —
    the one sentence that would send somebody to set up a screen they already
    have, spending the slot the answer failed to mention.
  */
  if (error) return fail(res, 503, "The screens could not be read.", error);

  /*
    The 14-day nudge rides on this read (056, deviceSession.ts). Fired after
    the response is prepared, never awaited by it: a mail failure must not
    turn "here are your screens" into an error the admin has to puzzle over.
  */
  const trusted = (data ?? [])[0];
  if (trusted) {
    void (async () => {
      const { data: family } = await supabase
        .from("families")
        .select("email, display_name")
        .eq("archive_id", archive)
        .maybeSingle();
      if (!family?.email) return;
      await maybeNotifyRenewal(
        archive,
        {
          id: trusted.id,
          session_expires_at: trusted.session_expires_at,
          renewal_notified_at: trusted.renewal_notified_at,
        },
        family.email as string,
        (family.display_name as string | null) || "there"
      );
    })().catch((err) => console.error("[settings] renewal notice check failed:", err));
  }

  res.json(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      is_recall_device: row.is_recall_device === true,
      trusted_at: row.trusted_at,
      last_used_at: row.last_used_at,
      software_version: row.software_version,
      session_expires_at: row.session_expires_at ?? null,
    }))
  );
});

/**
 * Renews the trusted screen's session (056, owner: "the admin can prolong it
 * remotely"). `requireRole` + archive-scoped, deliberately never reachable
 * by the device cookie itself — a device that could renew its own session
 * would be a lapsed or revoked screen extending its own life. Only someone
 * who can manage people, on a session the row still recognises, may bump it.
 */
settingsRouter.post("/screens/renew", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await renewScreen(archive);
  if (error) return fail(res, 500, "The screen could not be renewed.", error);
  if (!data) {
    return res.status(404).json({ error: "No trusted screen is paired to this archive." });
  }

  logActivity(req.profile, "screen_renewed", `${actorName(req.profile)} renewed the family screen`);
  res.json({ id: data.id, session_expires_at: data.session_expires_at });
});

/**
 * Retiring a browser screen the family paired.
 *
 * This is the way out that did not exist. Until now, freeing the single
 * screen slot meant the replacement ceremony — a link to the family inbox —
 * so a household whose screen had gone (sold laptop, wiped browser, an
 * address nobody reads any more) was stuck, and tonight that is not
 * hypothetical: no mail leaves production yet. An administrator standing in
 * the room can now say "that one is gone" and pair a new machine.
 *
 * A Recall device is refused, and refused by the row rather than by the
 * caller's word for it: the id is looked up, the flag is read from the
 * database, and only then is anything written.
 */
settingsRouter.post("/screens/:id/retire", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: screen, error: readError } = await supabase
    .from("installations")
    .select("id, name, is_trusted, is_recall_device")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (readError) return fail(res, 503, "That screen could not be read.", readError);
  if (!screen || screen.is_trusted !== true) {
    return res.status(404).json({ error: "That screen is not one of yours." });
  }
  if (screen.is_recall_device === true) {
    return res.status(409).json({
      error:
        "That is a Recall device. It stays with the archive — you can add another screen beside it, but this one is not retired from here.",
    });
  }

  const { error } = await supabase
    .from("installations")
    .update({ is_trusted: false, revoked_at: new Date().toISOString() })
    .eq("id", screen.id)
    .eq("archive_id", archive)
    .eq("is_recall_device", false);

  if (error) return fail(res, 500, "That screen could not be retired.", error);

  logActivity(
    req.profile,
    "screen_retired",
    `${actorName(req.profile)} retired the screen "${screen.name ?? "The family screen"}"`
  );

  res.json({ ok: true });
});

/**
 * Device requests (052) — the Devices page's "order one" button.
 *
 * A request, not an order: no payment exists yet, so the row records that
 * this family asked for this piece of hardware and the owner reads the list
 * from /owner. Admin-gated like everything that commits the family to
 * something arriving at the door.
 */
const DEVICE_KINDS = ["screen", "reader_dock", "hub"] as const;

settingsRouter.get("/device-requests", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("device_requests")
    .select("id, device_kind, note, created_at, handled_at")
    .eq("archive_id", archive)
    .order("created_at", { ascending: false });

  if (error) return fail(res, 500, "The requests could not be loaded.", error);
  res.json(data ?? []);
});

settingsRouter.post("/device-requests", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { device_kind, note } = req.body ?? {};
  if (!DEVICE_KINDS.includes(device_kind)) {
    return res.status(400).json({ error: "That is not a device we send." });
  }

  /*
    One OPEN request per kind per family. Pressing the button twice — a slow
    network, an impatient thumb — must not read to the owner as a family
    wanting two screens; a second ask while one is open is almost always the
    first ask, repeated.
  */
  const { data: open } = await supabase
    .from("device_requests")
    .select("id")
    .eq("archive_id", archive)
    .eq("device_kind", device_kind)
    .is("handled_at", null)
    .maybeSingle();
  if (open) {
    return res.status(409).json({
      error: "You have already asked for one — it is on its way to being handled.",
      code: "already_requested",
    });
  }

  const { data, error } = await supabase
    .from("device_requests")
    .insert({
      archive_id: archive,
      device_kind,
      note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
      requested_by: req.profile!.personId,
    })
    .select("id, device_kind, note, created_at, handled_at")
    .single();

  if (error) return fail(res, 500, "The request could not be saved.", error);
  res.status(201).json(data);
});
