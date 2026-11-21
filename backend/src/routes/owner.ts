import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { supabase } from "../config/supabase.js";
import { fail } from "../lib/errors.js";
import { exactIlike } from "../lib/exactIlike.js";
import { requirePlatformOwner } from "../middleware/auth.js";
import {
  DUMMY_PASSWORD_HASH,
  clearFamilyCookie,
  clearPasswordFailures,
  passwordLocked,
  recordPasswordFailure,
  revokeSession,
  verifyPassword,
  type FamilySession,
} from "../services/familyAuth.js";
import { newTotpSecret, openTotpSecret, sealTotpSecret, totpUri, verifyTotp } from "../services/totp.js";
import {
  clearStepUp,
  issueStepUp,
  ownerSession,
  readStepUp,
  recordOwnerAudit,
  requireOwnerStepUp,
} from "../services/ownerStepUp.js";
import { openMedia } from "../services/mediaCache.js";
import {
  founderTokenExpiry,
  generateFounderToken,
  hashFounderToken,
} from "../services/inviteCodes.js";
import { sendFoundingInviteEmail } from "../services/email.js";
import { env } from "../config/env.js";
import { CHANNEL_MEDIA_BUCKET } from "../services/media.js";
import { streamArchiveExport } from "../services/archiveExport.js";
import {
  OWNER_ACTIVITY_COLUMNS,
  OWNER_CHANNEL_COLUMNS,
  OWNER_FAMILY_COLUMNS,
  OWNER_INSTALLATION_COLUMNS,
  OWNER_MEDIA_COLUMNS,
  OWNER_PERSON_COLUMNS,
  OWNER_SECOND_FACTOR_COLUMNS,
  OWNER_VISIT_COLUMNS,
  FAMILY_PAYMENT_COLUMNS,
} from "../services/dto.js";

/**
 * The platform owner's dashboard (M55) — information, never content.
 *
 * This is the **single sanctioned exception** to per-archive scoping in the
 * whole codebase: aggregating across families is the entire point of the
 * page. That is exactly why every route here sits behind
 * `requirePlatformOwner`, why all three are `GET`, and why the columns they
 * may read are named constants in `dto.ts` rather than written inline.
 * Nothing else may copy this pattern; a route that needs family data and is
 * not this page must filter on `archiveId` like everything else.
 *
 * The boundary is structural, not a matter of what the page happens to
 * render. These queries select ids, counts, timestamps and the family's own
 * account email. They cannot return a channel title, a member's name, a
 * media path or a memory, because they never ask for one.
 *
 * There is also no owner override anywhere else: `platform_owner` satisfies
 * none of the media routes' checks, so the owner's own session is refused
 * another family's pictures exactly like any other stranger's would be.
 *
 * The dashboard reads are strictly `GET`. The doorstep below writes, because
 * minting and revoking an invitation is the one thing this surface is *for*
 * — and it writes only to tables that hold no family's content.
 */
export const ownerRouter = Router();

ownerRouter.use(requirePlatformOwner());

/**
 * What kind of failure this is (M68).
 *
 * The dashboard used to answer `database: "down"` for *any* query error,
 * which meant a renamed column or a permission refusal arrived on screen as
 * a calm red "unreachable" — the owner reading an outage where the truth was
 * a bug in this file. They need different reactions: an outage is waited out,
 * a fault is fixed, and telling them apart is the difference between staring
 * at a status light and reading a stack trace.
 *
 * Postgres and PostgREST hand back a `code` for faults they understood well
 * enough to refuse (42703 undefined column, 42501 insufficient privilege, and
 * their kin). A genuinely unreachable database produces a transport failure
 * with no such code.
 */
function classify(error: { code?: string; message?: string } | null): "up" | "down" | "error" {
  if (!error) return "up";
  return error.code ? "error" : "down";
}

/** Newest of several timestamps, ignoring the ones that are absent. */
function latest(...times: (string | null | undefined)[]): string | null {
  const real = times.filter((t): t is string => !!t);
  if (real.length === 0) return null;
  return real.reduce((a, b) => (a > b ? a : b));
}

/** Counts one column of rows into a map keyed by archive. */
function tally(rows: { archive_id: string | null }[] | null) {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    if (!row.archive_id) continue;
    counts.set(row.archive_id, (counts.get(row.archive_id) ?? 0) + 1);
  }
  return counts;
}

/** Newest timestamp per archive. */
function newest(rows: (Record<string, unknown> & { archive_id: string | null })[] | null, field: string) {
  const times = new Map<string, string>();
  for (const row of rows ?? []) {
    const at = row[field] as string | null;
    if (!row.archive_id || !at) continue;
    const current = times.get(row.archive_id);
    if (!current || at > current) times.set(row.archive_id, at);
  }
  return times;
}

/**
 * One row per family: who they are, how big they are, whether anyone is
 * actually using it.
 */
ownerRouter.get("/families", async (_req, res) => {
  const [families, people, channels, media, installations, activity, visits] = await Promise.all([
    supabase.from("families").select(OWNER_FAMILY_COLUMNS).order("created_at"),
    supabase.from("people").select(OWNER_PERSON_COLUMNS),
    supabase.from("channels").select(OWNER_CHANNEL_COLUMNS),
    supabase.from("media_files").select(OWNER_MEDIA_COLUMNS),
    supabase.from("installations").select(OWNER_INSTALLATION_COLUMNS),
    supabase.from("activity_log").select(OWNER_ACTIVITY_COLUMNS),
    supabase.from("channel_visits").select(OWNER_VISIT_COLUMNS),
  ]);

  /*
    A failed read must arrive as a failure (M221).

    This answered **200** with `families: []`. `api.ts` only throws on a
    non-2xx, so React Query never set `isError`, so the page's
    `isPending || isError` gate could not fire — and the table drew as "no
    families exist". Andy opens his dashboard the morning after launch, the
    database hiccups, and the screen tells him nobody signed up.

    Every guard written this cycle assumes a failed read arrives as a
    failure. Here the transport laundered it into an empty success, and no
    guard downstream of a 200 can help. It is also invisible to the
    unguarded-reads census, because the frontend call site looks correctly
    guarded — which it is.

    `/health` keeps its 200 deliberately and that is a different case: there,
    the outage IS the payload, the route's whole job is to report it, and
    every figure comes back null. Here the payload was a lie.
  */
  if (families.error) {
    console.error("[owner] families query failed:", families.error.message);
    return res.status(503).json({
      error: "The families could not be read.",
      database: classify(families.error),
      detail: families.error.message,
    });
  }

  /*
    And the six reads beside it, which nothing checked (M221).

    `tally()` does `rows ?? []`, so a failed `people` or `media_files` read
    produced **0 members, 0 channels, 0 memories** for every family on the
    platform — the same fabricated zero, one layer lower than the frontend
    guards can see. The list itself is true, so it still draws; the figures
    that could not be counted come back `null` and the page prints "—".
  */
  const counted = {
    members: !people.error,
    channels: !channels.error,
    media: !media.error,
    /*
      The three that were logged and not guarded — my own half-fix, caught
      by a mutation that survived (M221).

      `screen_paired` is the worst of them. An unread `installations` table
      leaves `screens` empty, `trusted` undefined, and every family on the
      platform prints **"no screen paired"** — so a household whose display
      has been on the wall since Tuesday reads as one that never set it up.
      That is the single figure most likely to make somebody act: it is the
      one that says a family never got started.

      `last_activity` is a maximum across three reads, which makes it fail
      in one direction only. Lose any one source and the answer can only
      come back **older** than the truth — a living family reported as
      dormant. So it needs all three, not any one.
    */
    screens: !installations.error,
    activity: !activity.error && !visits.error && !media.error,
  };
  for (const [what, res_] of Object.entries({
    people,
    channels,
    media,
    installations,
    activity,
    visits,
  })) {
    if (res_.error) console.error(`[owner] ${what} query failed:`, res_.error.message);
  }

  const memberCount = tally(people.data);
  const channelCount = tally(channels.data);
  const mediaCount = tally(media.data);

  /*
   * `last_activity` is the max across all three, not whichever one was
   * convenient. A family that only ever watches leaves rows in
   * `channel_visits`; one that only ever uploads leaves them in
   * `media_files`; management leaves them in `activity_log`. Reading one
   * source would report a living family as idle.
   */
  const lastVisit = newest(visits.data, "started_at");
  const lastAction = newest(activity.data, "created_at");
  const lastUpload = newest(media.data, "created_at");

  const rows = (families.data ?? []).map((family) => {
    const archive = family.archive_id as string | null;
    const screens = (installations.data ?? []).filter(
      (i) => i.archive_id === archive && !i.revoked_at
    );
    const trusted = screens.find((i) => i.is_trusted);

    return {
      family_id: family.id,
      archive_id: archive,
      family_name: family.display_name,
      email: family.email,
      created_at: family.created_at,
      is_platform_owner: family.platform_owner === true,
      /*
        `null` when that read failed, `0` when it genuinely counted nothing
        (M221). A brand-new family really does have 0 members and 0
        memories, and launch day is full of them — so the fix must not make
        a real zero unsayable. The difference is which question failed, not
        which number came back.
      */
      members: counted.members ? (archive ? (memberCount.get(archive) ?? 0) : 0) : null,
      channels: counted.channels ? (archive ? (channelCount.get(archive) ?? 0) : 0) : null,
      media_files: counted.media ? (archive ? (mediaCount.get(archive) ?? 0) : 0) : null,
      // Not knowable yet: nothing records a file's size. A seam, like
      // subscription below, rather than a fabricated number.
      storage_bytes: null,
      last_activity:
        counted.activity && archive
          ? latest(lastVisit.get(archive), lastAction.get(archive), lastUpload.get(archive))
          : null,
      /*
        `null` is "we could not check", distinct from `false` — "there is
        genuinely no trusted screen". The page has to be able to tell those
        apart, because only one of them is a family that needs a phone call.
      */
      screen_paired: counted.screens ? !!trusted : null,
      screen_last_seen: counted.screens ? (trusted?.last_used_at ?? null) : null,
      subscription: family.subscription ?? "—",
      // The manual-invoice state machine (055), moved by the routes below.
      payment: {
        state: family.payment_state ?? "none",
        tier: family.tier ?? null,
        invoice_number: family.invoice_number ?? null,
        invoice_amount_cents: family.invoice_amount_cents ?? null,
        invoiced_at: family.invoiced_at ?? null,
        paid_at: family.paid_at ?? null,
        activated_at: family.activated_at ?? null,
        paused_at: family.paused_at ?? null,
      },
    };
  });

  res.json({ families: rows, database: "up" });
});

/**
 * Is the platform itself alright?
 *
 * Answered live, never cached, and — importantly — this route does not error
 * when the database is unreachable. A health check that 500s during an
 * outage tells you nothing you did not already know and takes the page down
 * with it; the outage *is* the answer, so it is reported as one.
 */
ownerRouter.get("/health", async (_req, res) => {
  const probe = await supabase.from("families").select("id").limit(1);
  const database = classify(probe.error);

  if (database !== "up") {
    console.error("[owner] health probe failed:", probe.error?.message);
    return res.json({
      database,
      detail: probe.error?.message ?? null,
      families: null,
      memories: null,
      subscriptions: null,
      errors_24h: null,
      storage: null,
    });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  /*
   * The three the owner asked for by name — "the active families, how many
   * memories are created, how many subscriptions" — plus errors as a quieter
   * fourth. Counted with `head: true`, so none of these reads a single row of
   * anybody's content to produce its number.
   */
  const [families, memories, subscriptions, errors] = await Promise.all([
    supabase.from("families").select("id", { count: "exact", head: true }).eq("platform_owner", false),
    supabase.from("media_files").select("id", { count: "exact", head: true }),
    supabase
      .from("families")
      .select("id", { count: "exact", head: true })
      .not("subscription", "is", null),
    supabase
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("action_type", "error")
      .gte("created_at", since),
  ]);

  res.json({
    database: "up",
    detail: null,
    // The platform owner's own row is not a family on the platform.
    /*
      A count that ERRORED is not a count of zero (M221). The probe passing
      says the database answered; it does not say all four of these did, and
      `?? 0` turned any one of their failures into good news on the tile
      that exists to report bad news.
    */
    families: families.error ? null : (families.count ?? 0),
    memories: memories.error ? null : (memories.count ?? 0),
    // Honestly zero until plans exist; the seam is in place (034) so this
    // needs no redesign when they do.
    subscriptions: subscriptions.error ? null : (subscriptions.count ?? 0),
    errors_24h: errors.error ? null : (errors.count ?? 0),
    // Both buckets are private and nothing records a file's size, so total
    // storage is not answerable from here today.
    storage: null,
  });
});

/**
 * What has happened lately, newest first.
 *
 * Sourced from records that already exist. Founding invitations (M44) are
 * not built yet, so the feed simply has fewer kinds of thing in it — no new
 * event plumbing is added here for events that cannot happen.
 */
ownerRouter.get("/events", async (_req, res) => {
  const [families, installations] = await Promise.all([
    supabase.from("families").select(OWNER_FAMILY_COLUMNS).order("created_at", { ascending: false }).limit(50),
    supabase
      .from("installations")
      .select(OWNER_INSTALLATION_COLUMNS)
      .order("last_used_at", { ascending: false })
      .limit(50),
  ]);

  /*
    Both reads, and both as failures (M221).

    This checked `families` and let `installations` fall through into
    `?? []` — so a failed installations read produced a feed with no
    `screen_paired` entries in it, which reads as "no screen has ever been
    paired". And the families branch answered 200 with an empty feed, which
    reads as "nothing has happened". Neither is a thing this route knows.

    Nothing consumes `/owner/events` today. It is fixed anyway because the
    next thing that renders it inherits the fault silently, which is how the
    sibling route on the dashboard came to say the platform was quiet.
  */
  const failure = families.error ?? installations.error;
  if (failure) {
    console.error("[owner] events query failed:", failure.message);
    return res.status(503).json({
      error: "The recent events could not be read.",
      database: classify(failure),
      detail: failure.message,
    });
  }

  const events = [
    ...(families.data ?? []).map((f) => ({
      kind: "family_created" as const,
      at: f.created_at as string,
      archive_id: f.archive_id as string | null,
      detail: f.display_name as string,
    })),
    ...(installations.data ?? [])
      .filter((i) => i.is_trusted && i.last_used_at)
      .map((i) => ({
        kind: "screen_paired" as const,
        at: i.last_used_at as string,
        archive_id: i.archive_id as string | null,
        detail: "Trusted screen",
      })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 50);

  res.json({ events, database: "up" });
});

// ─────────────────────────────── the owner's own keys: step-up, two-step (access-5)

/*
  The platform owner's password was the whole credential behind every
  family's export (security review 29 Sep, access-5). Three things now stand
  beside it: an authenticator code at sign-in once two-step sign-in is on
  (checked in family.ts), the password again — and the code — before content
  leaves (`requireOwnerStepUp`), and a row in `owner_audit_log` for each.

  The routes below are the owner's own controls for the first two. They sit
  behind `requirePlatformOwner` like everything here, so to anyone else they
  are the same 404.
*/

interface SecondFactorRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  failed_password_attempts: number | null;
  password_locked_until: string | null;
  password_lock_count: number | null;
  owner_totp_secret: string | null;
  owner_totp_enabled_at: string | null;
  owner_totp_last_step: number | string | null;
}

async function secondFactorRow(familyId: string) {
  const { data, error } = await supabase
    .from("families")
    .select(OWNER_SECOND_FACTOR_COLUMNS)
    .eq("id", familyId)
    .maybeSingle();
  return { row: data as unknown as SecondFactorRow | null, error };
}

/**
 * The per-IP brake, as on /family/login. It is in memory and per instance,
 * which is why the per-session count below exists too.
 */
const secondFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
  skip: () => process.env.NODE_ENV === "test",
});

/*
  A session that keeps getting the password or the code wrong is not the
  owner. Five in a row and the session itself is revoked — whoever holds a
  lifted cookie gets five guesses, not a rate. The owner, if it was them,
  signs in again. In memory, per instance — so each wrong answer is also
  counted on the family row, the same database lockout the sign-in keeps
  (064), which every instance shares.

  A wrong code while CONFIRMING a new authenticator is not counted: it proves
  nothing either way (the secret was only shown behind a step-up), and a
  fumbled first code must not sign the owner out.
*/
const MAX_SECOND_FACTOR_FAILURES = 5;
const secondFactorFailures = new Map<string, number>();

/** Test seam: a count carried between tests would decide the wrong ones. */
export function forgetSecondFactorFailures() {
  secondFactorFailures.clear();
}

async function refuseSecondFactor(
  res: Response,
  owner: FamilySession,
  message: string,
  code: string
) {
  void recordOwnerAudit({ familyId: owner.familyId, action: "step_up_failed" });
  await recordPasswordFailure(owner.familyId);
  const failures = (secondFactorFailures.get(owner.id) ?? 0) + 1;
  if (failures >= MAX_SECOND_FACTOR_FAILURES) {
    secondFactorFailures.delete(owner.id);
    await revokeSession(owner.id);
    clearFamilyCookie(res);
    clearStepUp(res);
    return res.status(401).json({
      error: "Too many wrong attempts. You have been signed out; sign in again.",
      code: "signed_out",
    });
  }
  secondFactorFailures.set(owner.id, failures);
  return res.status(401).json({ error: message, code });
}

/*
  A right code that has already been spent is not a wrong answer.

  Sign-in spends the code it was given, and the authenticator keeps showing
  that same code for the rest of its 30 seconds. An owner who signs in and
  clicks Export straight away types it again — rightly — and used to be told
  "That password or code is not right", counted toward the database lockout
  and toward the five that revoke the session. So a used code gets its own
  answer, and neither count. It is only ever reached with the right password
  and a code that was valid moments ago, so it tells nobody anything they
  did not already hold.
*/
const CODE_USED = {
  error: "That code has just been used. Wait for the next code on your authenticator app and enter that one.",
  code: "code_used",
};

/**
 * Checks an authenticator code against the stored secret and spends it.
 *
 * A code is good for one use: the step it matched is written to
 * `owner_totp_last_step` in the same statement that checks it is newer than
 * the last one accepted, so a code seen over a shoulder — or replayed from a
 * request log — within its 90-second window is refused, and two requests
 * racing one code produce one winner. "used" is a right code already spent.
 */
async function spendCode(row: SecondFactorRow, code: unknown): Promise<"ok" | "bad" | "used" | "error"> {
  if (!row.owner_totp_secret) return "bad";
  let secret: string;
  try {
    secret = openTotpSecret(row.owner_totp_secret);
  } catch (err) {
    console.error("[owner] the two-step secret could not be opened:", err);
    return "error";
  }
  const result = verifyTotp(secret, code);
  if (!result.ok) return "bad";
  const last = row.owner_totp_last_step === null ? null : Number(row.owner_totp_last_step);
  if (last !== null && result.step <= last) return "used";

  const { data, error } = await supabase
    .from("families")
    .update({ owner_totp_last_step: result.step })
    .eq("id", row.id)
    .or(`owner_totp_last_step.is.null,owner_totp_last_step.lt.${result.step}`)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[owner] the two-step code could not be spent:", error.message);
    return "error";
  }
  // Another request spent this step first.
  return data ? "ok" : "used";
}

/** Is a step-up live on this session, and will one need a code? */
ownerRouter.get("/step-up", async (req, res) => {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error || !row) return fail(res, 500, "Your sign-in could not be read.", error);
  const live = readStepUp(req, owner);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    active: !!live,
    expires_at: live ? live.expiresAt.toISOString() : null,
    code_required: !!row.owner_totp_enabled_at,
  });
});

/**
 * The step-up itself: the password again, and the code when two-step
 * sign-in is on. Earns the ten-minute cookie in services/ownerStepUp.ts.
 */
ownerRouter.post("/step-up", secondFactorLimiter, async (req: Request, res: Response) => {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error) return fail(res, 500, "Your sign-in could not be read.", error);

  // The same lock the sign-in honours, so the step-up is not a way around it.
  if (passwordLocked(row)) {
    return res.status(429).json({ error: "Too many attempts. Try again later.", code: "locked" });
  }

  // Verified whatever happens, so a missing password costs what a wrong one does.
  const ok = await verifyPassword(row?.password_hash ?? DUMMY_PASSWORD_HASH, password);
  if (!row || !row.password_hash || !password || !ok) {
    return refuseSecondFactor(res, owner, "That password or code is not right.", "step_up_refused");
  }

  if (row.owner_totp_enabled_at) {
    const spent = await spendCode(row, req.body?.code);
    if (spent === "error") return fail(res, 500, "Your code could not be checked.");
    if (spent === "used") return res.status(401).json(CODE_USED);
    if (spent === "bad") {
      return refuseSecondFactor(res, owner, "That password or code is not right.", "step_up_refused");
    }
  }

  const audited = await recordOwnerAudit({ familyId: owner.familyId, action: "step_up" });
  if (!audited) return fail(res, 500, "The confirmation could not be recorded. Try again.");

  secondFactorFailures.delete(owner.id);
  await clearPasswordFailures(row);
  const expiresAt = issueStepUp(res, owner);
  res.json({ ok: true, expires_at: expiresAt.toISOString() });
});

/** Whether two-step sign-in is on. Never the secret. */
ownerRouter.get("/totp", async (req, res) => {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error || !row) return fail(res, 500, "Your sign-in could not be read.", error);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    enrolled: !!row.owner_totp_enabled_at,
    enrolled_at: row.owner_totp_enabled_at ?? null,
    // A secret was issued and never confirmed with a code.
    pending: !row.owner_totp_enabled_at && !!row.owner_totp_secret,
  });
});

/**
 * Step one: a fresh secret, shown once.
 *
 * Behind the step-up, because a lifted session that could enrol its own
 * authenticator would both keep the owner out and keep itself in. The secret
 * is stored sealed and inert (`owner_totp_enabled_at` null) until a code
 * from it is confirmed, so an abandoned set-up changes nothing about signing
 * in. Starting again replaces a pending secret, never an enrolled one.
 */
ownerRouter.post("/totp/setup", requireOwnerStepUp, async (_req, res) => {
  const owner = res.locals.owner as FamilySession;
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error || !row) return fail(res, 500, "Your sign-in could not be read.", error);
  if (row.owner_totp_enabled_at) {
    return res.status(409).json({ error: "Two-step sign-in is already on. Turn it off first.", code: "already_enrolled" });
  }

  const audited = await recordOwnerAudit({ familyId: owner.familyId, action: "totp_setup" });
  if (!audited) return fail(res, 500, "The set-up could not be recorded. Try again.");

  const secret = newTotpSecret();
  const { data, error: writeError } = await supabase
    .from("families")
    .update({ owner_totp_secret: sealTotpSecret(secret), owner_totp_enabled_at: null, owner_totp_last_step: null })
    .eq("id", owner.familyId)
    .is("owner_totp_enabled_at", null)
    .select("id")
    .maybeSingle();
  if (writeError) return fail(res, 500, "Two-step sign-in could not be set up.", writeError);
  if (!data) {
    return res.status(409).json({ error: "Two-step sign-in is already on. Turn it off first.", code: "already_enrolled" });
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({ uri: totpUri(secret, row.email ?? "platform owner"), secret });
});

/** Step two: a code from the new secret turns it on. */
ownerRouter.post("/totp/confirm", secondFactorLimiter, async (req, res) => {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error || !row) return fail(res, 500, "Your sign-in could not be read.", error);
  if (row.owner_totp_enabled_at) {
    return res.status(409).json({ error: "Two-step sign-in is already on.", code: "already_enrolled" });
  }
  if (!row.owner_totp_secret) {
    return res.status(409).json({ error: "Start the set-up first.", code: "not_started" });
  }

  let secret: string;
  try {
    secret = openTotpSecret(row.owner_totp_secret);
  } catch (err) {
    return fail(res, 500, "Two-step sign-in could not be checked. Start the set-up again.", err);
  }
  const result = verifyTotp(secret, req.body?.code);
  // Not counted (see MAX_SECOND_FACTOR_FAILURES): a fumbled first code.
  if (!result.ok) return res.status(401).json({ error: "That code is not right.", code: "bad_code" });

  const audited = await recordOwnerAudit({ familyId: owner.familyId, action: "totp_enabled" });
  if (!audited) return fail(res, 500, "Two-step sign-in could not be recorded. Try again.");

  const { data, error: writeError } = await supabase
    .from("families")
    .update({ owner_totp_enabled_at: new Date().toISOString(), owner_totp_last_step: result.step })
    .eq("id", owner.familyId)
    .is("owner_totp_enabled_at", null)
    .select("id, owner_totp_enabled_at")
    .maybeSingle();
  if (writeError) return fail(res, 500, "Two-step sign-in could not be turned on.", writeError);
  if (!data) return res.status(409).json({ error: "Two-step sign-in is already on.", code: "already_enrolled" });

  secondFactorFailures.delete(owner.id);
  res.json({ enrolled: true, enrolled_at: (data as { owner_totp_enabled_at?: string }).owner_totp_enabled_at ?? null });
});

/** Turning it off takes a valid code — the device itself, not only the session. */
ownerRouter.post("/totp/disable", secondFactorLimiter, async (req, res) => {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });
  const { row, error } = await secondFactorRow(owner.familyId);
  if (error || !row) return fail(res, 500, "Your sign-in could not be read.", error);
  if (!row.owner_totp_enabled_at) {
    return res.status(409).json({ error: "Two-step sign-in is not on.", code: "not_enrolled" });
  }

  const spent = await spendCode(row, req.body?.code);
  if (spent === "error") return fail(res, 500, "Your code could not be checked.");
  if (spent === "used") return res.status(401).json(CODE_USED);
  if (spent === "bad") return refuseSecondFactor(res, owner, "That code is not right.", "bad_code");

  const audited = await recordOwnerAudit({ familyId: owner.familyId, action: "totp_disabled" });
  if (!audited) return fail(res, 500, "The change could not be recorded. Try again.");

  const { error: writeError } = await supabase
    .from("families")
    .update({ owner_totp_secret: null, owner_totp_enabled_at: null, owner_totp_last_step: null })
    .eq("id", owner.familyId);
  if (writeError) return fail(res, 500, "Two-step sign-in could not be turned off.", writeError);

  secondFactorFailures.delete(owner.id);
  res.json({ enrolled: false });
});

// ──────────────────────────────────────────── the doorstep: who gets in (M44)

/**
 * Everything waiting at the door: people who asked, and invitations already
 * out.
 *
 * Both are about strangers and prospects, not about families — no archive is
 * named here and none could be, so this stays inside the boundary the rest of
 * the surface keeps.
 */
ownerRouter.get("/door", async (_req, res) => {
  const [requests, invitations] = await Promise.all([
    supabase
      .from("invitation_requests")
      .select("id, email, name, note, status, created_at, interested_tier, billing_period")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("founding_invitations")
      .select("id, email, note, created_at, expires_at, accepted_at, revoked_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  /*
    A failed read is a failure, not an empty doorstep (M221).

    This answered **200** with `requests: []` and `invitations: []`, so the
    page's `isError` never fired and the dashboard said *"Nobody is waiting
    at the door"* — about a query that never came back. On a screen whose
    only job is to tell the platform owner what is going on, that is the
    worst possible failure mode: it is calm, it is specific, and it is
    wrong. Somebody asking to join could sit unanswered for a week with the
    dashboard confirming every day that nobody had asked.

    The 200 also defeated the page-side guards written for this mission:
    `doorFailed` cannot become true for an answer that succeeded, so those
    guards were a fix that could not fire. Both halves were needed, and only
    this one is load-bearing.

    `database` and `detail` still travel, because the owner is the one
    person who should be told *which* kind of failure it was.
  */
  if (requests.error || invitations.error) {
    const failure = requests.error ?? invitations.error;
    console.error("[owner] doorstep query failed:", failure?.message);
    return res.status(503).json({
      error: "The doorstep could not be read.",
      database: classify(failure),
      detail: failure?.message ?? null,
    });
  }

  const now = Date.now();
  res.json({
    requests: requests.data ?? [],
    invitations: (invitations.data ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      note: i.note,
      created_at: i.created_at,
      // One word for the state, computed here so the page never has to
      // work out what an unexpired-unaccepted-unrevoked row means.
      state: i.revoked_at
        ? "revoked"
        : i.accepted_at
          ? "accepted"
          : new Date(i.expires_at).getTime() < now
            ? "expired"
            : "waiting",
      expires_at: i.expires_at,
    })),
    database: "up",
  });
});

/**
 * Mint a founding invitation and send it.
 *
 * The token exists in readable form exactly once, in the email and in this
 * response — the row keeps only its HMAC. That is deliberate: the audit trail
 * records that an invitation was created and to whom, never the secret, so a
 * leaked `founding_invitations` table cannot be used to found anything.
 *
 * The response carries the link so the platform owner can hand it over
 * themselves when mail does not arrive, which is the same accommodation
 * member invitations already make.
 */
ownerRouter.post("/door/invitations", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 1000) : null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  /*
    An exact match, not a pattern (security review 29 Sep, input-1). Raw,
    `_` and `%` in the typed address were LIKE wildcards: `j_n@example.com` found
    `jan@example.com`. `exactIlike` escapes them; an address with `*` in it (which
    PostgREST cannot escape) matches nothing, exactly as if no family had it.
  */
  const pattern = exactIlike(email);

  // Somebody who already has a family does not need a founding invitation,
  // and minting one would create a second family under the same address.
  const { data: already } = pattern === null
    ? { data: null }
    : await supabase
        .from("families")
        .select("id")
        .ilike("email", pattern)
        .maybeSingle();
  if (already) return res.status(409).json({ error: "That address already has a family." });

  const token = generateFounderToken();
  const { data, error } = await supabase
    .from("founding_invitations")
    .insert({ email, note, token_hash: hashFounderToken(token), expires_at: founderTokenExpiry() })
    .select("id, expires_at")
    .single();

  if (error) {
    // The partial unique index: one live invitation per address.
    const duplicate = (error as { code?: string }).code === "23505";
    return res.status(duplicate ? 409 : 500).json({
      error: duplicate
        ? "That address already has an invitation waiting. Revoke it first."
        : "The invitation could not be created.",
    });
  }

  const link = `${env.frontendOrigin}/invite/${token}`;
  const sent = await sendFoundingInviteEmail(email, link);

  // The request that produced this is answered — that address's request,
  // and not every request a wildcard in it would have matched.
  if (pattern !== null) {
    await supabase
      .from("invitation_requests")
      .update({ status: "invited", handled_at: new Date().toISOString() })
      .ilike("email", pattern);
  }

  res.status(201).json({ id: data.id, email, link, sent: sent.success, expires_at: data.expires_at });
});

/** Take an invitation back. Spent ones are history and cannot be revoked. */
ownerRouter.post("/door/invitations/:id/revoke", async (req, res) => {
  const { data, error } = await supabase
    .from("founding_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) return res.status(500).json({ error: "That could not be revoked." });
  if (!data) return res.status(404).json({ error: "Nothing to revoke." });
  res.json({ ok: true });
});

/** Set a request aside without inviting. It stays on the list, marked. */
ownerRouter.post("/door/requests/:id/dismiss", async (req, res) => {
  const { error } = await supabase
    .from("invitation_requests")
    .update({ status: "dismissed", handled_at: new Date().toISOString() })
    .eq("id", req.params.id);

  if (error) return res.status(500).json({ error: "That could not be dismissed." });
  res.json({ ok: true });
});

/**
 * The fulfilment queue (design 18j) — what Recall sees, not the family.
 *
 * A family is shown "preparing for delivery" and told it will be with her in
 * three or four days (18g). This is the other side of that sentence: the
 * cards actually waiting to be printed, oldest first, so the promise has
 * somebody keeping it.
 *
 * It sits on the owner surface for the same reason everything else here does
 * — it spans every family, and no family may see another's. The columns are
 * chosen the same way too: enough to print and post a card, and nothing
 * about the people beyond the names that go on it. No email, no phone, no
 * address; the address is read at print time from the recipient's own row,
 * once, rather than copied into a queue that would then hold every
 * subscriber's home address in one list.
 */
/**
 * Hardware the families have asked for (052) — the other queue.
 *
 * Same shape of promise as fulfilment: a family pressed a button that says
 * something will arrive, and this list is where somebody keeps that promise.
 * Names only, never contact details — the address is read at dispatch time
 * from the family's own row, not copied into a queue.
 */
ownerRouter.get("/device-requests", async (_req, res) => {
  const { data, error } = await supabase
    .from("device_requests")
    .select(
      "id, archive_id, device_kind, note, created_at, handled_at, " +
        "requester:people!device_requests_requested_by_fkey(name)"
    )
    .is("handled_at", null)
    .order("created_at", { ascending: true });

  if (error) return fail(res, 500, "The requests could not be read.", error);
  res.json({ waiting: (data ?? []).length, requests: data ?? [] });
});

ownerRouter.post("/device-requests/:id/handled", async (req, res) => {
  const { data, error } = await supabase
    .from("device_requests")
    .update({ handled_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .is("handled_at", null)
    .select("id, handled_at")
    .maybeSingle();

  if (error) return fail(res, 500, "The request could not be updated.", error);
  if (!data) {
    return res.status(409).json({ error: "That request is not waiting.", code: "not_waiting" });
  }
  res.json(data);
});

ownerRouter.get("/fulfilment", async (_req, res) => {
  const { data, error } = await supabase
    .from("nfc_cards")
    .select(
      "id, archive_id, kind, state, created_at, shipping_reference, shipping_carrier, " +
        "failure_reason, " +
        "channel:channels!nfc_cards_channel_id_fkey(number, title), " +
        "sender:people!nfc_cards_from_person_id_fkey(name), " +
        "recipient:people!nfc_cards_to_person_id_fkey(name)"
    )
    /*
      Every state an operator still has work in. `queued` alone was the first
      version, and it made the queue look empty while four cards sat stuck in
      `printing` with nobody watching them — the queue's whole job is that the
      "three or four days" promised in 18g has somebody keeping it, and a card
      cannot be kept an eye on if it drops off the list the moment it moves.
      `sent`, `delivered` and `returned` are finished as far as printing goes.
    */
    .in("state", ["queued", "printing", "shipped", "failed"])
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (error) return fail(res, 500, "The queue could not be read.", error);

  /*
    Who the envelope is for, joined per archive (053, owner-directed) — and
    whether there is an address to put on it, never the address itself.

    This list used to carry every in-flight family's postal address, with no
    step-up and no audit row: a lifted owner session got every queued
    family's name and home in one request, and nothing showed it. The address
    is half of what the print sheet guards (access-5), so it now leaves only
    through GET /fulfilment/:id/print, one card at a time, behind the step-up
    and a 'print' row in owner_audit_log. The queue keeps what it needs to be
    worked: whose card, and a loud warning when the family has given no
    address yet. Only archives with a card in flight are read.
  */
  const rows = (data ?? []) as unknown as {
    archive_id: string;
    created_at: string;
    state: string;
  }[];
  const archives = [...new Set(rows.map((r) => r.archive_id))];
  const recipients = new Map<string, { name: string | null; has_address: boolean }>();
  if (archives.length) {
    const { data: subjects } = await supabase
      .from("settings")
      .select("archive_id, full_name, display_name, delivery_address")
      .in("archive_id", archives);
    for (const s of subjects ?? []) {
      recipients.set(s.archive_id as string, {
        name: (s.full_name as string) || (s.display_name as string) || null,
        has_address: typeof s.delivery_address === "string" && s.delivery_address.trim().length > 0,
      });
    }
  }
  const cards = ((data ?? []) as unknown as Record<string, unknown>[]).map((c) => ({
    ...c,
    deliver_to: recipients.get(c.archive_id as string) ?? { name: null, has_address: false },
  }));
  /*
    Oldest-first, so the oldest card is the FIRST row. This read `rows.length - 1`
    and reported the NEWEST card's age as "oldest 2 days" — a wrong number that
    fails in the dangerous direction: a queue that has been sitting for a week
    reads as fresh, which is exactly the condition this figure exists to catch.
  */
  const oldest = rows.length ? rows[0].created_at : null;
  const waiting = rows.filter((r) => r.state === "queued").length;
  res.json({ queued: waiting, inFlight: rows.length, oldest, cards });
});

/**
 * Mark one queued card as printed and posted.
 *
 * `sent` is terminal, and the guard is on the state rather than the button:
 * processing the same card twice is a second card through somebody's door.
 */
/**
 * Everything needed to print ONE card (owner-directed, the manual wave).
 *
 * The second — and last — sanctioned exception to "the owner surface reads
 * no family content", as narrow as the job: the card being printed carries a
 * photograph, and a printed card without its photograph is not the product.
 * The scope is one card, and only a card standing in the fulfilment queue —
 * a family that queues a physical print has, by that act, handed these exact
 * pixels to whoever prints it. There is no route that lists media, and a
 * card outside the in-flight states is refused.
 *
 * Content leaves here, so it asks what the export asks (access-5): a step-up
 * in the last ten minutes, and a row in `owner_audit_log` before anything is
 * sent. The photograph is not a Supabase signed URL any more (secrets-3,
 * database-9): that was an hour-long bearer link into a private bucket which
 * nothing here could take back — the pattern M165/F60 removed from her
 * screen. It is served by the route below, behind the same two guards.
 */
const PRINTABLE_STATES = ["queued", "printing", "failed"];

/** One card in the print queue, with the archive it belongs to. Null when it is not printable. */
async function printableCard(id: string, columns: string) {
  return supabase
    .from("nfc_cards")
    .select(columns)
    .eq("id", id)
    .in("state", PRINTABLE_STATES)
    .maybeSingle();
}

ownerRouter.get("/fulfilment/:id/print", requireOwnerStepUp, async (req, res) => {
  const owner = res.locals.owner as FamilySession;
  const { data: card, error } = await printableCard(
    req.params.id as string,
    "id, kind, state, archive_id, media_file_id, created_at, " +
      "channel:channels!nfc_cards_channel_id_fkey(number, title, description), " +
      "sender:people!nfc_cards_from_person_id_fkey(name, relationship), " +
      "recipient:people!nfc_cards_to_person_id_fkey(name)"
  );

  if (error) return fail(res, 500, "The card could not be read.", error);
  if (!card) {
    return res.status(404).json({ error: "That card is not waiting to be printed." });
  }

  const row = card as unknown as Record<string, unknown>;
  const archive = row.archive_id as string;

  const audited = await recordOwnerAudit({
    familyId: owner.familyId,
    action: "print",
    archiveId: archive,
    cardId: row.id as string,
  });
  if (!audited) return fail(res, 500, "The print could not be recorded, so it was not opened.");

  const [{ data: subject }, media] = await Promise.all([
    supabase
      .from("settings")
      .select("full_name, display_name, delivery_address")
      .eq("archive_id", archive)
      .maybeSingle(),
    row.media_file_id
      ? supabase
          .from("media_files")
          .select("id")
          .eq("id", row.media_file_id as string)
          // The card's own archive, like every other media read (CLAUDE.md).
          // The composite key from 047 already forbids a card pointing
          // elsewhere; this says so at the query too.
          .eq("archive_id", archive)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const { data: archiveRow } = await supabase
    .from("archives")
    .select("created_at")
    .eq("id", archive)
    .maybeSingle();

  res.json({
    id: row.id,
    kind: row.kind,
    state: row.state,
    channel: row.channel,
    sender: row.sender,
    recipient: row.recipient,
    deliver_to: {
      name: (subject?.full_name as string) || (subject?.display_name as string) || null,
      address: (subject?.delivery_address as string) ?? null,
    },
    archive_since: (archiveRow?.created_at as string) ?? null,
    // A backend address, never a storage one: the browser sees no bucket, no
    // path and no project, and the step-up and the audit apply to the bytes.
    photo_url: media.data ? `${env.publicUrl}/api/owner/fulfilment/${row.id as string}/photo` : null,
  });
});

const PRINT_PHOTO_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * The photograph on a card being printed, streamed from the private bucket
 * (secrets-3). The same scope as the print sheet — one card, in the queue,
 * its own archive — and the same step-up. Nothing is cached anywhere: the
 * permission to see it ends when the card leaves the queue.
 */
ownerRouter.get("/fulfilment/:id/photo", requireOwnerStepUp, async (req, res) => {
  const owner = res.locals.owner as FamilySession;
  const { data: card, error } = await printableCard(req.params.id as string, "id, archive_id, media_file_id");
  if (error) return fail(res, 500, "The card could not be read.", error);
  const row = card as unknown as { id: string; archive_id: string; media_file_id: string | null } | null;
  if (!row?.media_file_id) return res.status(404).json({ error: "That card has no photograph to print." });

  const { data: media, error: mediaError } = await supabase
    .from("media_files")
    .select("storage_path")
    .eq("id", row.media_file_id)
    .eq("archive_id", row.archive_id)
    .maybeSingle();
  if (mediaError) return fail(res, 500, "The photograph could not be read.", mediaError);
  const storagePath = (media as { storage_path?: string } | null)?.storage_path;
  if (!storagePath) return res.status(404).json({ error: "That card has no photograph to print." });

  const audited = await recordOwnerAudit({
    familyId: owner.familyId,
    action: "print_photo",
    archiveId: row.archive_id,
    cardId: row.id,
  });
  if (!audited) return fail(res, 500, "The print could not be recorded, so it was not opened.");

  const file = await openMedia(CHANNEL_MEDIA_BUCKET, storagePath);
  if (!file) return res.status(503).json({ error: "The photograph is unavailable right now." });

  const dot = storagePath.lastIndexOf(".");
  const extension = dot === -1 ? "" : storagePath.slice(dot).toLowerCase();
  res.setHeader("Content-Type", PRINT_PHOTO_TYPES[extension] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "private, no-store");
  if (file.size !== undefined) res.setHeader("Content-Length", String(file.size));

  // Same two endings as /api/media: the source dies mid-file, or the viewer
  // leaves. Either way the read is let go.
  file.stream.on("error", (err) => {
    console.error("[owner] print photo failed mid-response:", err);
    res.destroy();
  });
  res.on("close", () => file.stream.destroy());
  file.stream.pipe(res);
});

ownerRouter.post("/fulfilment/:id/sent", async (req, res) => {
  const reference = typeof req.body?.shipping_reference === "string"
    ? req.body.shipping_reference.trim()
    : null;
  const carrier = typeof req.body?.shipping_carrier === "string"
    ? req.body.shipping_carrier.trim()
    : null;

  const { data, error } = await supabase
    .from("nfc_cards")
    .update({
      state: "sent",
      sent_at: new Date().toISOString(),
      shipping_reference: reference || null,
      shipping_carrier: carrier || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    /*
      No kind filter (owner-directed): an ordered NFC card ships exactly like
      a postcard — the kind column tells the operator whether to print a card
      or pick a coded sticker. NFC cards the family already holds have state
      NULL and never enter this list.
    */
    /*
      Both states that come before the post. This was `queued` only, which was
      right while `queued` was the whole queue — once an operator could mark a
      card `printing`, that same card could never be marked sent, and the only
      way out was back through the database. A card leaves for the post from
      wherever it was waiting.
    */
    .in("state", ["queued", "printing"])
    .select("id, state, sent_at, shipping_reference, shipping_carrier")
    .maybeSingle();

  if (error) return fail(res, 500, "The card could not be updated.", error);
  if (!data) {
    return res.status(409).json({
      error: "That card is not waiting to be posted. Somebody may have moved it already.",
      code: "not_queued",
    });
  }
  res.json(data);
});

/**
 * The other three things an operator does to a row (18j).
 *
 * Each one names the state it may be applied FROM, in the `.eq("state", …)`
 * below rather than in a check the caller could skip. Two people working the
 * same queue, or one person with a stale tab, would otherwise print a card
 * twice or mark a shipped card as failed — and the guard has to live where the
 * write happens, because a button can be clicked from a page rendered an hour
 * ago.
 *
 * A 409 with a code is the answer to "somebody got there first". It is not an
 * error the operator caused, and the queue simply needs re-reading.
 */
const TRANSITIONS: Record<string, { from: string; to: string; patch?: () => Record<string, unknown> }> = {
  /* Sent to the print house. */
  printing: { from: "queued", to: "printing" },
  /* It came back unprinted. The reason is typed by whoever was told it. */
  failed: {
    from: "printing",
    to: "failed",
    patch: () => ({ failed_at: new Date().toISOString() }),
  },
  /*
    Retry puts it back at the end of the queue and CLEARS the reason — a stale
    "printer error" sitting on a card that is now printing fine would be read
    next week as the current state of it.
  */
  retry: {
    from: "failed",
    to: "queued",
    patch: () => ({ failed_at: null, failure_reason: null }),
  },
};

/*
 * ───────────────────────────────────────────── the first euro (055)
 *
 * Manual invoices, as decided 27 Aug: the owner invoices, the family pays by
 * transfer, the owner marks it paid. Five moves, each a conditional update
 * keyed on the state it leaves — two tabs pressing the same button produce
 * one transition and one 409, never two invoices. Prices are the pricing
 * page's, in cents, incl. 21% VAT; a tier with no settled price (the Dock)
 * must be given an amount by hand.
 */
/*
 * Two configurations (owner, 17 Sep 2026 — the four-tier ladder is retired).
 * A reader or a keyboard bought alone is a package on top of Recall,
 * offered later — never a separate priced tier. Both cost the same
 * subscription; only the Dock adds a one-time device charge, and that
 * charge has no settled price yet (doc 15's own instruction: settle the
 * real production cost before a number goes on a page), so `once: null`
 * means the owner must type it by hand on the first Dock invoice.
 */
const TIERS = ["digital", "dock"] as const;
type Tier = (typeof TIERS)[number];
export const TIER_PRICES: Record<
  Tier,
  { once: number | null; monthly: number; yearly: number; label: string }
> = {
  digital: { once: 0, monthly: 2500, yearly: 27500, label: "Recall" },
  dock: { once: null, monthly: 2500, yearly: 27500, label: "Recall Dock" },
};
type BillingPeriod = "monthly" | "yearly";
function periodPrice(price: (typeof TIER_PRICES)[Tier], period: BillingPeriod): number {
  return period === "yearly" ? price.yearly : price.monthly;
}

const PAYMENT_MOVES: Record<
  string,
  { from: string[]; patch: (row: Record<string, unknown>) => Record<string, unknown> }
> = {
  paid: {
    from: ["invoiced", "paused"],
    patch: (row) => ({
      payment_state: "active",
      paid_at: new Date().toISOString(),
      activated_at: (row.activated_at as string | null) ?? new Date().toISOString(),
      paused_at: null,
      subscription: (row.tier as string | null) ?? null,
    }),
  },
  pause: {
    from: ["invoiced", "active"],
    patch: () => ({ payment_state: "paused", paused_at: new Date().toISOString() }),
  },
  resume: {
    from: ["paused"],
    patch: (row) => ({
      payment_state: row.paid_at ? "active" : "invoiced",
      paused_at: null,
    }),
  },
  close: {
    from: ["none", "invoiced", "active", "paused"],
    patch: () => ({ payment_state: "closed", closed_at: new Date().toISOString(), subscription: null }),
  },
};

ownerRouter.post("/families/:id/invoice", async (req, res) => {
  const tier = req.body?.tier;
  if (typeof tier !== "string" || !(TIERS as readonly string[]).includes(tier)) {
    return res.status(400).json({ error: "Which configuration is being invoiced?" });
  }
  const period: BillingPeriod = req.body?.billing_period === "yearly" ? "yearly" : "monthly";
  const price = TIER_PRICES[tier as Tier];

  // `amount_cents`, when given, is the ONE-TIME device charge only — the
  // subscription for the chosen period is added on top, never overridden by
  // hand, so the invoice always carries the real €25/mo or €275/yr figure.
  const deviceCharge = Number.isInteger(req.body?.amount_cents) ? (req.body.amount_cents as number) : price.once;
  if (deviceCharge === null || deviceCharge < 0) {
    return res.status(400).json({ error: "This configuration has no settled device price. Give the amount." });
  }
  const amount = deviceCharge + periodPrice(price, period);

  const { data: before, error: readError } = await supabase
    .from("families")
    .select(FAMILY_PAYMENT_COLUMNS)
    .eq("id", req.params.id)
    .maybeSingle();
  if (readError) return fail(res, 500, "The family could not be read.", readError);
  const state = (before as Record<string, unknown> | null)?.payment_state;
  if (!before || !["none", "closed"].includes(state as string)) {
    return res.status(409).json({ error: "That family already has an invoice or a running plan.", code: "wrong_state" });
  }

  const minted = await supabase.rpc("next_invoice_number");
  const number = Array.isArray(minted.data) ? minted.data[0] : minted.data;
  if (minted.error || typeof number !== "string") {
    return fail(res, 500, "An invoice number could not be issued.", minted.error);
  }

  const { data, error } = await supabase
    .from("families")
    .update({
      payment_state: "invoiced",
      tier,
      billing_period: period,
      invoice_number: number,
      invoice_amount_cents: amount,
      invoiced_at: new Date().toISOString(),
      paused_at: null,
      ...(typeof req.body?.note === "string" ? { payment_note: req.body.note.trim().slice(0, 500) || null } : {}),
    })
    .eq("id", req.params.id)
    .in("payment_state", ["none", "closed"])
    .select(FAMILY_PAYMENT_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The invoice could not be recorded.", error);
  if (!data) {
    return res.status(409).json({ error: "That family already has an invoice or a running plan.", code: "wrong_state" });
  }
  res.status(201).json(data);
});

/**
 * The archive they keep — one zip, streamed (M241).
 *
 * The Recall Archive home visit ends with a drive in the family's hand, and
 * the sentence that sells it is "it works without me and without any
 * subscription". This is that drive.
 *
 * Owner-only, like everything on this router: `requirePlatformOwner` runs
 * above, so a family admin reaching this path is refused before a byte of
 * anyone's photographs is read. And more than owner-only since access-5: the
 * owner's password (and code) again within ten minutes, and an audit row.
 *
 * The response is committed the moment the first chunk goes out, so an error
 * after that cannot become a JSON body — it can only destroy the socket, and
 * the owner sees a truncated download rather than a zip that is quietly
 * missing half a family. Errors BEFORE the stream opens still answer properly.
 */
ownerRouter.get("/families/:id/export", requireOwnerStepUp, async (req, res) => {
  const owner = res.locals.owner as FamilySession;
  const { data: family, error } = await supabase
    .from("families")
    .select(OWNER_FAMILY_COLUMNS)
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return fail(res, 500, "The family could not be read.", error);
  if (!family) return res.status(404).json({ error: "No such family." });

  const archive = (family as Record<string, unknown>).archive_id as string | null;
  if (!archive) {
    // The platform owner's own row owns no archive (M55): there is nothing
    // behind this credential to export.
    return res.status(409).json({ error: "That sign-in has no archive to export." });
  }

  /*
    Recorded before a byte leaves (access-5). A family's whole archive walking
    off the platform with no trace of who took it, or when, is the one
    outcome this row exists to rule out — so when the row cannot be written,
    the export does not start.
  */
  const audited = await recordOwnerAudit({
    familyId: owner.familyId,
    action: "export",
    targetFamilyId: (family as Record<string, unknown>).id as string,
    archiveId: archive,
  });
  if (!audited) return fail(res, 500, "The export could not be recorded, so it did not start.");

  const stamp = new Date();
  const filename = `recall-archief-${stamp.toISOString().slice(0, 10)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // No length is known in advance — the zip is built as it is sent.
  res.setHeader("Cache-Control", "no-store");

  try {
    await streamArchiveExport(res, archive, stamp);
  } catch (err) {
    console.error("[export] failed", err);
    if (!res.headersSent) {
      /*
       * The zip headers are staged, not sent, until the first byte. Express's
       * res.json() leaves an existing Content-Type alone, so failing here
       * without clearing them would hand the owner an error message labelled
       * application/zip — a file that downloads and will not open, instead of
       * a message that says what went wrong.
       */
      res.removeHeader("Content-Type");
      res.removeHeader("Content-Disposition");
      return fail(res, 500, "The archive could not be exported.", err);
    }
    res.destroy();
  }
});

ownerRouter.post("/families/:id/:action", async (req, res) => {
  const move = PAYMENT_MOVES[req.params.action];
  if (!move) return res.status(404).json({ error: "No such action." });

  const { data: before, error: readError } = await supabase
    .from("families")
    .select(FAMILY_PAYMENT_COLUMNS)
    .eq("id", req.params.id)
    .maybeSingle();
  if (readError) return fail(res, 500, "The family could not be read.", readError);
  if (!before || !move.from.includes((before as Record<string, unknown>).payment_state as string)) {
    return res.status(409).json({
      error: `That family is not ${move.from.join(" or ")}. Somebody may have moved it already.`,
      code: "wrong_state",
    });
  }

  const { data, error } = await supabase
    .from("families")
    .update(move.patch(before as Record<string, unknown>))
    .eq("id", req.params.id)
    .in("payment_state", move.from)
    .select(FAMILY_PAYMENT_COLUMNS)
    .maybeSingle();
  if (error) return fail(res, 500, "The family could not be updated.", error);
  if (!data) return res.status(409).json({ error: "Somebody moved it first.", code: "wrong_state" });
  res.json(data);
});

/**
 * Everything the printed invoice says, in one payload. The seller block is
 * the frontend's (lib/seller.ts) — one place, read by the footer, the terms
 * and this sheet alike. The buyer is the family's admin: name, and address
 * when they gave one (people.address exists for the postcards, and an
 * invoice is the other thing a postal address is for).
 */
ownerRouter.get("/families/:id/invoice", async (req, res) => {
  const { data: family, error } = await supabase
    .from("families")
    .select(OWNER_FAMILY_COLUMNS)
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return fail(res, 500, "The family could not be read.", error);
  if (!family || !family.invoice_number) {
    return res.status(404).json({ error: "No invoice has been issued to that family." });
  }

  const archive = family.archive_id as string | null;
  const [{ data: admin }, { data: subject }] = await Promise.all([
    archive
      ? supabase
          .from("people")
          .select("name, address")
          .eq("archive_id", archive)
          .eq("role", "admin")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    archive
      ? supabase.from("settings").select("display_name").eq("archive_id", archive).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const tier = (family.tier as Tier | null) ?? null;
  const price = tier ? TIER_PRICES[tier] : null;
  const period = (family.billing_period as BillingPeriod | null) ?? "monthly";
  res.json({
    invoice_number: family.invoice_number,
    invoiced_at: family.invoiced_at,
    due_at: family.invoiced_at
      ? new Date(Date.parse(family.invoiced_at as string) + 14 * 86_400_000).toISOString()
      : null,
    state: family.payment_state,
    paid_at: family.paid_at ?? null,
    tier,
    tier_label: price?.label ?? null,
    amount_cents: family.invoice_amount_cents,
    billing_period: period,
    monthly_cents: price?.monthly ?? null,
    yearly_cents: price?.yearly ?? null,
    buyer: {
      family_name: family.display_name,
      email: family.email,
      admin_name: (admin as { name?: string } | null)?.name ?? null,
      address: (admin as { address?: string | null } | null)?.address ?? null,
    },
    for_whom: (subject as { display_name?: string } | null)?.display_name ?? null,
  });
});

ownerRouter.post("/fulfilment/:id/:action", async (req, res) => {
  const move = TRANSITIONS[req.params.action];
  if (!move) return res.status(404).json({ error: "No such action." });

  const reason =
    typeof req.body?.failure_reason === "string" ? req.body.failure_reason.trim() : "";

  const { data, error } = await supabase
    .from("nfc_cards")
    .update({
      state: move.to,
      updated_at: new Date().toISOString(),
      ...(move.patch ? move.patch() : {}),
      ...(move.to === "failed" && reason ? { failure_reason: reason } : {}),
    })
    .eq("id", req.params.id)
    /* No kind filter: ordered NFC cards ride the same rail (the state
       machine is the guard — a held NFC card has state NULL and can never
       match `move.from`). */
    .eq("state", move.from)
    .select("id, state, failure_reason, failed_at")
    .maybeSingle();

  if (error) return fail(res, 500, "The card could not be updated.", error);
  if (!data) {
    return res.status(409).json({
      error: `That card is not ${move.from}. Somebody may have moved it already.`,
      code: "wrong_state",
    });
  }
  res.json(data);
});


