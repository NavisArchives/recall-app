import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { supabase } from "../config/supabase.js";
import { FAMILY_PAYMENT_COLUMNS, FAMILY_SIGN_IN_COLUMNS } from "../services/dto.js";
import { env } from "../config/env.js";
import { fail } from "../lib/errors.js";
import {
  DEVICE_COOKIE,
  PROFILE_COOKIE,
  issueDeviceCookie,
  issueProfileCookie,
  readDevice,
  actingProfile,
} from "../middleware/auth.js";
import { LANDING_PATH } from "../services/accessCodes.js";
import {
  checkPin,
  clearPinFailures,
  isLocked,
  isValidPinFormat,
  recordPinFailure,
} from "../services/pins.js";
import {
  DUMMY_PASSWORD_HASH,
  FAMILY_COOKIE,
  clearFamilyCookie,
  claimPasswordAttempt,
  clearPasswordFailures,
  clearRecoveredCookie,
  elevateSession,
  hashPassword,
  hashRecoveryToken,
  issueRecoveredCookie,
  mintSecret,
  openFamilySession,
  passwordLocked,
  passwordProblem,
  readFamilySession,
  recoveredFamily,
  revokeAllSessions,
  revokeSession,
  revokeSessionByToken,
  verifyPassword,
  type FamilySession,
} from "../services/familyAuth.js";
import {
  sendFamilyRecoveryEmail,
  sendScreenPairedEmail,
  sendScreenReplacementEmail,
} from "../services/email.js";
import { renewalDeadline } from "../services/deviceSession.js";
import { openTotpSecret, verifyTotp } from "../services/totp.js";
import { exactIlike } from "../lib/exactIlike.js";

export const familyRouter = Router();

/**
 * Signing in to a Family, from anywhere.
 *
 * Implements `docs/specs/identity-model.md`. Before this there was no way
 * back in at all: signup turned one browser into a household installation
 * and, once those cookies went, the archive was unreachable — and the family
 * could not sign up again either, because the address was taken.
 *
 * Two stages, deliberately. The family password opens the profile chooser
 * and nothing else; the PIN says who is at the keyboard. Neither is much on
 * its own, which is the point: a stolen password shows a list of first names,
 * and a guessed PIN needs the password first.
 */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
  skip: () => process.env.NODE_ENV === "test",
});

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One refusal for every way signing in can fail: no such family, wrong
 * password, suspended — and, since 064, a password locked by too many wrong
 * attempts. Anything more specific turns this form into a way to ask whether
 * an address belongs to a family caring for someone with dementia — the same
 * reasoning as M19, on a door that is used far more. A lock is only ever on a
 * real family's row, so a sentence of its own would answer exactly that
 * question; one sentence covers both.
 */
const REFUSED = {
  error:
    "That email and password did not match, or there were too many attempts. Wait a little and try again.",
  // For a page that must tell this apart from a later step's refusal (the
  // pairing PIN) without reading prose. The same on every path it covers.
  code: "refused",
};

interface SignInFamily {
  id: string;
  email: string | null;
  display_name: string | null;
  archive_id: string | null;
  password_hash: string | null;
  session_version: number;
  status: string;
  platform_owner: boolean | null;
  failed_password_attempts?: number | null;
  password_locked_until?: string | null;
  password_lock_count?: number | null;
  owner_totp_secret?: string | null;
  owner_totp_enabled_at?: string | null;
  owner_totp_last_step?: number | string | null;
}

/**
 * The family behind an email and password, or null — one answer for every
 * way that fails.
 *
 * The work is comparable whether or not the family exists. Verifying argon2
 * takes real time; returning early when there is no row would make "no such
 * family" measurably faster than "wrong password", and the timing alone would
 * answer the question the response refuses to. A locked row is verified
 * against the dummy hash for the same reason: its password is not checked at
 * all while the lock stands (064), but the time is spent all the same.
 *
 * The same holds for the database. Every attempt claims its count before the
 * password is checked (claimPasswordAttempt) — an unknown address with the nil
 * id, which touches no row — and nothing is written after a wrong password.
 * Counting after the check used to put one more awaited round trip on a
 * known family's wrong password than on an unknown address, and the response
 * time alone said which addresses were families. It also let a burst of
 * guesses in flight together all be checked before the tenth one locked.
 *
 * The address is matched exactly, ignoring case (authn-2). Handed to ilike
 * raw, `_` and `%` in a typed address were wildcards, and one typed pattern
 * could stand for somebody else's family.
 *
 * The caller decides when a sign-in has fully succeeded and clears the count
 * then — for the platform owner that is only after the second factor.
 * `claimed` says the database counted this attempt (or it was let past a
 * lock), so that clear must write even if the row as read looked clean.
 *
 * `recovered` is the family this browser recovered within the day (the
 * RECOVERED_COOKIE, /login only): its attempt is checked against the real
 * password even while the lock stands. `lockBypassed` says it was used, so
 * a wrong password can spend the cookie.
 */
async function familyByPassword(
  email: unknown,
  password: unknown,
  recovered: string | null = null
): Promise<{ family: SignInFamily | null; lockBypassed: boolean; claimed: boolean }> {
  const none = { family: null, lockBypassed: false, claimed: false };
  if (typeof email !== "string" || !EMAIL_SHAPE.test(email.trim())) return none;
  if (typeof password !== "string" || !password) return none;

  const pattern = exactIlike(email.trim().toLowerCase());
  let family: SignInFamily | null = null;
  if (pattern) {
    const { data } = await supabase
      .from("families")
      .select(FAMILY_SIGN_IN_COLUMNS)
      .ilike("email", pattern)
      .maybeSingle();
    family = (data as unknown as SignInFamily | null) ?? null;
  }

  // A family that never set a password has nothing to guess, so it is
  // claimed like an unknown address and counts nothing.
  const guessable = family?.password_hash ? family : null;
  const claim = await claimPasswordAttempt(guessable?.id ?? null);
  const allowed = claim ?? !passwordLocked(guessable);
  const lockBypassed = !allowed && !!guessable && recovered === guessable.id;

  const hash = ((allowed || lockBypassed) && guessable?.password_hash) || DUMMY_PASSWORD_HASH;
  const ok = await verifyPassword(hash, password);

  if (!guessable || !(allowed || lockBypassed)) return none;
  if (!ok) return { family: null, lockBypassed, claimed: false };
  return { family: guessable, lockBypassed, claimed: claim === true || lockBypassed };
}

/*
 * The platform owner's second factor (access-5).
 *
 * Asked for only after the password is right, so the question itself says
 * nothing to somebody who does not have it. A wrong code — or a right one
 * replayed inside its own window — counts against the same lockout as a
 * wrong password: guessing six digits must cost what guessing the password
 * costs.
 */
const NEEDS_CODE = {
  error: "Enter the six-digit code from your authenticator app.",
  needs_code: true,
  code: "needs_code",
};
const WRONG_CODE = {
  error: "That code did not work. Enter the current six-digit code from your authenticator app.",
  needs_code: true,
  code: "needs_code",
};

async function ownerSecondFactor(
  family: SignInFamily,
  code: unknown
): Promise<"ok" | "missing" | "wrong" | "error"> {
  if (code === undefined || code === null || code === "") return "missing";
  if (!family.owner_totp_secret) return "error";

  let secret: string;
  try {
    secret = openTotpSecret(family.owner_totp_secret);
  } catch {
    return "error";
  }

  const result = verifyTotp(secret, code);
  if (!result.ok) return "wrong";
  const last = family.owner_totp_last_step;
  if (last !== null && last !== undefined && result.step <= Number(last)) return "wrong";

  // Conditional, so two sign-ins racing one code resolve to one winner: only
  // the UPDATE that still finds an older step lands.
  const { data, error } = await supabase
    .from("families")
    .update({ owner_totp_last_step: result.step })
    .eq("id", family.id)
    .or(`owner_totp_last_step.is.null,owner_totp_last_step.lt.${result.step}`)
    .select("id")
    .maybeSingle();
  if (error) return "error";
  return data ? "ok" : "wrong";
}

/** The session behind the request, or null. Never throws. */
async function currentSession(req: {
  cookies?: Record<string, string>;
}): Promise<FamilySession | null> {
  return readFamilySession(req.cookies?.[FAMILY_COOKIE]);
}

// ────────────────────────────────────────────────────────────────── log in

familyRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password, code } = req.body ?? {};
  const { family, lockBypassed, claimed } = await familyByPassword(email, password, recoveredFamily(req));

  // The recovery cookie buys one attempt past the lock; any refusal spends it.
  if (lockBypassed && !family) clearRecoveredCookie(res);
  if (!family) return res.status(401).json(REFUSED);
  if (family.status !== "active") return res.status(401).json(REFUSED);

  if (family.platform_owner === true && family.owner_totp_enabled_at) {
    const second = await ownerSecondFactor(family, code);
    // Asking for the code is the one answer that keeps the cookie: the owner
    // types the password first and the code second, as two requests.
    if (second === "missing") return res.status(401).json(NEEDS_CODE);
    if (second === "error") {
      return fail(res, 500, "Could not sign in.", { family: family.id, message: "second factor unreadable" });
    }
    if (second === "wrong") {
      // Already counted: the attempt was claimed before the password was
      // checked, and it stays counted because nothing clears it.
      if (lockBypassed) clearRecoveredCookie(res);
      return res.status(401).json(WRONG_CODE);
    }
  }

  // The whole credential is proved: the lockout's counts start again.
  await clearPasswordFailures(family, { claimed });
  clearRecoveredCookie(res);

  /*
   * The platform owner has no archive, and that is the point (M55).
   *
   * Every other family row owns exactly one archive and its password opens
   * the chooser of people who live there. The platform owner is not a person
   * in a family — no shelf, no profiles, no PIN, and no memories to reach.
   * So the password — with the authenticator code above, once enrolled — is
   * the whole credential and it opens one page: the dashboard, which holds information about families and none of their
   * content.
   *
   * An ordinary family that somehow lost its archive is still an error, as
   * it always was. Only the platform owner is allowed to have none.
   */
  const isPlatformOwner = family.platform_owner === true;
  if (!family.archive_id && !isPlatformOwner) {
    return fail(res, 500, "This family has no archive.", { family: family.id });
  }

  const opened = await openFamilySession(
    res,
    {
      id: family.id,
      // Null for the platform owner, exactly as the untyped row always passed it (M55).
      archive_id: family.archive_id as string,
      session_version: family.session_version,
    },
    { userAgent: req.get("user-agent") ?? undefined }
  );
  if (!opened) return fail(res, 500, "Could not sign in.", { message: "session not opened" });

  /*
   * The previous family's keys do not survive the switch (M116 / F33).
   *
   * One browser, two families: whoever signed into family A here earlier
   * left A's `recall_profile` — and possibly A's `recall_device` — in this
   * jar, and `requireRole`'s fallback serves them whenever the new session
   * is un-elevated. The pinned probe had one jar answering two archives in
   * the same instant. So the profile claim is evicted on every family
   * sign-in — the person at the keyboard is being re-decided — and the
   * device credential is evicted only when its archive is not this
   * family's: a same-family sign-in on the household screen must not
   * unpair her display.
   *
   * The cookies are named one by one rather than through `clearSessions`,
   * because that helper also clears the family cookie — and the fresh
   * `recall_family` for the family that just proved its password was set
   * two lines up, in this same response. Two Set-Cookie lines for one name
   * resolve to the later one (RFC 6265), so routing this through the helper
   * signed the family in and out in a single reply.
   */
  const staleDevice = readDevice(req);
  res.clearCookie(PROFILE_COOKIE, { path: "/" });
  if (staleDevice && staleDevice.archiveId !== family.archive_id) {
    res.clearCookie(DEVICE_COOKIE, { path: "/" });
  }

  res.json({ ok: true, next: family.archive_id ? "/profiles" : "/owner" });
});

/**
 * Pairing the family screen — the other half of the one sign-in page (M111).
 *
 * The family credential AND an administrator's PIN (access-2), electing this
 * machine as the family screen. The password alone used to do it, and every
 * member knows the password: a trusted screen reads every channel, private
 * ones included, and outlives a password reset. Now an admin of this family
 * confirms with their own PIN — counted against their profile's lockout like
 * any other PIN — and the family inbox hears about every pairing.
 *
 * Per `docs/specs/identity-model.md` § "The one trusted device": it
 * mints the long-lived `recall_device` credential and starts the subject's
 * year-long profile session. The "installation username" that used to guard
 * this is gone as a user-facing concept — the installation row keeps an
 * internal identity, auto-minted exactly as signup's is, and nobody ever
 * types it.
 *
 * Exclusivity carries the security weight: while a trusted device exists, no
 * other device can become one. The check below gives the kind answer; the
 * partial unique index from migration 027 referees the race two browsers can
 * win against any check, and its 23505 is translated into the same refusal.
 */
/*
 * The refusal names the real way through (F32 → M117): the replacement
 * ceremony, gated by the family email. `code` is for the sign-in page,
 * which offers to send the link right where the refusal lands.
 */
const SCREEN_TAKEN = {
  error:
    "Your family already has its screen. To move Recall to this one, use a replacement link sent to the family email — the old screen is retired the moment this one takes over.",
  code: "screen_taken",
};

/**
 * The moment a machine becomes the family screen.
 *
 * Shared by the everyday pairing (the family password, on a family with no
 * screen yet) and the replacement ceremony (an emailed token, the old
 * screen retired first). Everything past the caller's own gate is
 * identical, and it is exactly the sequence M111/M116 hardened: one insert
 * the unique index can referee, one identity left in the jar, the
 * subject's world started. Two doors sharing one tail means the security
 * fixes cannot drift apart.
 *
 * Responds on every path; callers return immediately after.
 */
async function becomeFamilyScreen(
  req: Request,
  res: Response,
  archiveId: string
): Promise<void> {
  /*
   * The internal identity, auto-minted as signup's is: a random username the
   * family never sees and a secret hashed and thrown away — the device
   * cookie is the actual credential. The id is minted here rather than read
   * back so the insert is one statement the unique index can referee.
   */
  const installationId = randomUUID();
  const { error: insertError } = await supabase.from("installations").insert({
    id: installationId,
    name: "The family screen",
    username: `web-${randomBytes(6).toString("hex")}`,
    secret_hash: await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id }),
    archive_id: archiveId,
    is_trusted: true,
    trusted_at: new Date().toISOString(),
    // 056: the renewal cadence starts the moment a screen becomes hers.
    session_expires_at: renewalDeadline(),
  });

  if (insertError) {
    // The race was lost: another browser became the screen between the check
    // and the insert. Same situation, same kind answer.
    if ((insertError as { code?: string }).code === "23505") {
      res.status(409).json(SCREEN_TAKEN);
      return;
    }
    fail(res, 500, "The screen could not be set up.", insertError);
    return;
  }

  /*
   * The jar holds one identity from here on (M116/F33, the pairing door).
   *
   * A remote family session left on this browser — whoever's — would keep
   * answering `requireRole` while the fresh device cookie answers
   * `requireDevice`, and the two disagree about precedence: half a page
   * from each family, observed live. This machine is becoming the family
   * screen, which runs on device + subject and nothing else; the remote
   * session is revoked server-side, not merely forgotten.
   */
  const staleToken = req.cookies?.[FAMILY_COOKIE];
  if (staleToken) {
    // By token, not by resolving first: a key is evicted for being
    // presented at this door, not for still being believable.
    await revokeSessionByToken(staleToken);
    clearFamilyCookie(res);
  }
  // The stale person goes too — named directly rather than via
  // `clearSessions`, which would also clear cookies this response is about
  // to set. If the archive has a subject, their fresh cookie lands below
  // and wins; if not, the jar simply ends up without a profile claim.
  res.clearCookie(PROFILE_COOKIE, { path: "/" });

  issueDeviceCookie(res, { installationId, archiveId });

  // The subject's world begins here: her year-long session starts with the
  // screen, per the spec, so the display greets her without another step. An
  // archive that has no subject yet still gets its screen.
  const { data: subjects } = await supabase
    .from("people")
    .select("id, name, role")
    .eq("archive_id", archiveId)
    .eq("role", "user")
    .neq("status", "deactivated")
    .is("archived_at", null)
    .order("created_at")
    .limit(1);

  const subject = subjects?.[0];
  if (subject) {
    issueProfileCookie(res, {
      personId: subject.id as string,
      name: subject.name as string,
      role: "user",
      archiveId,
    });
  }

  res.json({ ok: true, next: "/" });
}

/*
 * Who may confirm a pairing: an active admin of this archive who has a PIN.
 * A PIN-less admin has nothing to confirm with, and a co-author does not
 * decide which machine reads every channel.
 */
interface PairingAdmin {
  id: string;
  name: string;
  role: string;
  status: string;
  archived_at: string | null;
  pin_hash: string | null;
  locked_until: string | null;
}

const ADMIN_REQUIRED = {
  error: "An administrator of this family must confirm with their PIN.",
  code: "admin_required",
};

const NO_ADMIN = {
  error:
    "Nobody in this family has an administrator PIN yet, so nobody can confirm this screen. Ask for a replacement link sent to the family email instead.",
  code: "no_admin",
};

/**
 * Everything both pairing calls check before any PIN: the family password
 * (with its lockout), a live family with an archive, a free screen slot —
 * and who could confirm. Responds itself and returns null on every refusal.
 */
async function pairingGate(
  req: Request,
  res: Response
): Promise<{ family: SignInFamily; archiveId: string; admins: PairingAdmin[] } | null> {
  const { email, password } = req.body ?? {};
  const { family, claimed } = await familyByPassword(email, password);

  if (!family || family.status !== "active") {
    res.status(401).json(REFUSED);
    return null;
  }

  // The platform owner's row owns no archive on purpose (M55) — there is no
  // living room behind this credential, so there is no screen to pair. The
  // caller has proved the password, so an honest answer is safe here.
  //
  // Refused BEFORE the count is cleared, and the count is never cleared
  // here for the owner. The owner's sign-in has a second factor that this
  // door never asks for; a password alone resetting the lockout let nine
  // wrong codes at /login, one right password here, and nine more, go on
  // forever — the six digits guessed with no lock at all.
  if (family.platform_owner === true || !family.archive_id) {
    res.status(409).json({ error: "This sign-in has no family screen to set up." });
    return null;
  }
  const archiveId = family.archive_id;

  // The password was right; the pairing may still need an admin, but the
  // password's own count starts again.
  await clearPasswordFailures(family, { claimed });

  // The kind refusal. The index below is the rule; this is the sentence —
  // and it must refuse exactly where the insert would fail, so the flag is
  // re-checked on the returned rows too, not only in the query. Revoked rows
  // deliberately count: the index does not exclude them.
  /*
    A Recall device does not hold the family's slot (047).

    This counted every trusted row, so a household that had been shipped
    hardware could never pair the tablet in the kitchen: its one slot was
    spent on a device it never chose to spend it on. The index below it was
    narrowed to browser screens for the same reason, and the two must agree
    or this gives a kind refusal to something the database would have
    allowed — or worse, promises something the database then refuses with a
    23505 the caller reads as a server fault.
  */
  const { data: trusted, error: trustedError } = await supabase
    .from("installations")
    .select("id, is_trusted, is_recall_device")
    .eq("archive_id", archiveId)
    .eq("is_trusted", true);

  if (trustedError) {
    fail(res, 500, "The screen could not be set up.", trustedError);
    return null;
  }

  /*
    A row is exempt only when it PROVES it is hardware — `!== true` blocks,
    rather than `=== false` letting anything else through.

    Written this way round on purpose. The narrow version filtered the query
    on `is_recall_device = false`, so any trusted row whose flag was absent
    or unreadable simply vanished from the answer and the slot looked empty.
    That is a guard that fails **open** on the one question it exists to
    settle, and the cost is a second display in somebody's house. The column
    is `not null default false`, so in the database this distinction never
    arises — which is exactly why it must not be the thing the rule leans on.
  */
  if ((trusted ?? []).some((row) => row.is_trusted === true && row.is_recall_device !== true)) {
    res.status(409).json(SCREEN_TAKEN);
    return null;
  }

  const { data: people, error: peopleError } = await supabase
    .from("people")
    .select("id, name, role, status, archived_at, pin_hash, locked_until")
    .eq("archive_id", archiveId)
    .eq("role", "admin")
    .eq("status", "active")
    .is("archived_at", null)
    .order("created_at");
  if (peopleError) {
    fail(res, 500, "The screen could not be set up.", peopleError);
    return null;
  }

  // Re-checked on the rows, not only in the query: the rule is who may
  // confirm, and a filter that went missing must not widen it.
  const admins = ((people ?? []) as PairingAdmin[]).filter(
    (p) => p.role === "admin" && p.status === "active" && !p.archived_at && !!p.pin_hash
  );
  return { family, archiveId, admins };
}

/**
 * Step one on the setup page: the password is right and the slot is free —
 * which administrators can confirm? First names only, the same thing the
 * chooser shows a password holder.
 */
familyRouter.post("/pair-screen/admins", loginLimiter, async (req, res) => {
  const gate = await pairingGate(req, res);
  if (!gate) return;
  res.json({ admins: gate.admins.map((a) => ({ id: a.id, name: a.name })) });
});

familyRouter.post("/pair-screen", loginLimiter, async (req, res) => {
  const gate = await pairingGate(req, res);
  if (!gate) return;
  const { family, archiveId, admins } = gate;

  if (admins.length === 0) return res.status(409).json(NO_ADMIN);

  const { admin_person_id: adminId, pin } = req.body ?? {};
  if (typeof adminId !== "string" || !isValidPinFormat(pin)) {
    return res.status(401).json(ADMIN_REQUIRED);
  }

  // Only someone from the list above: an id from another family, a
  // co-author or a PIN-less admin is simply not one of them.
  const admin = admins.find((a) => a.id === adminId);
  if (!admin || !admin.pin_hash) return res.status(401).json(ADMIN_REQUIRED);

  if (isLocked(admin.locked_until)) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }

  const check = await checkPin(admin.pin_hash, pin);
  if (!check.ok) {
    // Counted exactly as a PIN at the chooser is: one database move, and a
    // guess that could not be counted is refused rather than free.
    const counted = await recordPinFailure(admin, archiveId);
    if (!counted) {
      return fail(res, 503, "Verification is not possible right now.", { person: admin.id });
    }
    return res.status(401).json({ error: "That PIN is not right." });
  }
  await clearPinFailures(admin.id, archiveId, check.legacy ? { pin } : null);

  await becomeFamilyScreen(req, res, archiveId);

  /*
   * The family inbox hears about every new screen (access-2). Sent to the
   * address on the row, after the answer has gone: a mail that fails must not
   * un-pair a screen that has already started playing.
   */
  if (res.statusCode === 200 && family.email) {
    try {
      await sendScreenPairedEmail(family.email, family.display_name ?? "there");
    } catch (err) {
      console.error("[family] screen-paired notice failed:", err);
    }
  }
});

// ───────────────────────────────────── replacing the screen (M117)

/**
 * Requesting a replacement link.
 *
 * Gated by the family email, not the password, because minting a second
 * trusted device is the one action the password must not perform — that is
 * M116's whole point. Whoever reads the family inbox speaks for the
 * household; 027 reserved the `device` purpose for exactly this ceremony.
 * The answer is identical whether or not the address belongs to a family
 * (M19's discipline, same as /recover).
 */
familyRouter.post("/replace-screen", loginLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  const answer = {
    ok: true,
    message: "If that address belongs to a family, we have sent the next step.",
  };

  /*
   * Who the link is for is answered by the session first, and by the typed
   * address only when there is no session (F-review).
   *
   * The chooser asks for this link from inside the house — the kiosk holds a
   * device credential, a signed-in relative holds a family session — and
   * neither page has a family email to send, nor should have to ask for one
   * it already implies. The 9a foot posted an empty body, the route read no
   * address, and its anti-enumeration answer ("if that address belongs to a
   * family…") came back 200 with nothing sent: the screen said the email was
   * on its way and no token was ever minted. A calm sentence covering an
   * action that did not happen is the worst shape a refusal can take.
   *
   * Deriving from the session is also the stricter reading. A caller the
   * archive already recognises can only ever aim this at their *own* family,
   * where the typed-address form must stay open to anyone (the link lands in
   * the family inbox, which is the actual gate — M117).
   */
  const session = await currentSession(req);
  const device = readDevice(req);
  const scopedArchive = session?.archiveId ?? device?.archiveId ?? null;

  const lookup = supabase
    .from("families")
    .select("id, email, display_name, archive_id, status");

  let family: {
    id: string;
    email: string;
    display_name: string | null;
    archive_id: string | null;
    status: string;
  } | null = null;

  if (session?.familyId) {
    ({ data: family } = await lookup.eq("id", session.familyId).maybeSingle());
  } else if (scopedArchive) {
    ({ data: family } = await lookup.eq("archive_id", scopedArchive).maybeSingle());
  } else {
    if (typeof email !== "string" || !EMAIL_SHAPE.test(email.trim())) return res.json(answer);
    // Exact, ignoring case (authn-2): a `*` cannot be matched exactly, so it
    // matches nothing and gets the same calm sentence as an unknown address.
    const pattern = exactIlike(email.trim().toLowerCase());
    if (!pattern) return res.json(answer);
    ({ data: family } = await lookup.ilike("email", pattern).maybeSingle());
  }

  /*
   * A row that could not complete the ceremony gets the same calm sentence:
   * the platform owner has no screen, a suspended family has no standing, and
   * a family with no address on file has nowhere to send a link. That last
   * one is not hypothetical bookkeeping — the send path is reached with
   * whatever this row holds, and handing it nothing used to throw inside an
   * awaited call, which in an Express handler is a request that never answers
   * rather than one that fails.
   */
  if (!family || family.status !== "active" || !family.archive_id || !family.email) {
    return res.json(answer);
  }

  // One live link per family (027's partial index): asking again supersedes
  // the last link rather than racing it or failing on the index.
  await supabase
    .from("family_recovery_tokens")
    .delete()
    .eq("family_id", family.id)
    .eq("purpose", "device")
    .is("consumed_at", null);

  const token = mintSecret();
  const { error } = await supabase.from("family_recovery_tokens").insert({
    family_id: family.id,
    token_hash: hashRecoveryToken(token),
    purpose: "device",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  // A token that never landed must not be mailed: the link would be dead on
  // arrival, and the sentence below would still be true.
  if (error) return res.json(answer);

  /*
   * Sent to the address on the family's own row, never to one the caller
   * supplied. The typed-address form finds the row by that address anyway, so
   * this changes nothing there — and it means the session-derived paths, which
   * were handed no address at all, cannot be talked into delivering a
   * screen-takeover link anywhere but the family's own inbox.
   */
  await sendScreenReplacementEmail(family.email, family.display_name ?? "there", token);
  res.json(answer);
});

/**
 * Completing the ceremony, on the new screen.
 *
 * The token is consumed conditionally — single-use even against itself.
 * Then the old screen retires: `is_trusted` drops, so 027's partial index
 * frees the one-per-family slot (the trap M111 dodged — a row left trusted
 * would refuse the family a screen forever), and `revoked_at` lands, so
 * the old machine's thirty-day cookie stops answering at the door on its
 * very next request (M42's row-decides rule). Only then does this machine
 * take over, through the same tail the everyday pairing uses.
 *
 * The archive comes from the token's own family row and from nowhere else.
 */
familyRouter.post("/replace-screen/complete", loginLimiter, async (req, res) => {
  const DEAD_LINK = { error: "That link is not valid any more." };
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !token) return res.status(400).json(DEAD_LINK);

  // Consumed conditionally, so a link cannot be spent twice even if two
  // requests arrive together (same shape as /recover/complete).
  const { data: consumed } = await supabase
    .from("family_recovery_tokens")
    .update({ consumed_at: new Date().toISOString() })
    .eq("token_hash", hashRecoveryToken(token))
    .eq("purpose", "device")
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("family_id")
    .maybeSingle();
  if (!consumed) return res.status(400).json(DEAD_LINK);

  const { data: family } = await supabase
    .from("families")
    .select("id, archive_id, status")
    .eq("id", consumed.family_id)
    .maybeSingle();
  if (!family || family.status !== "active" || !family.archive_id) {
    return res.status(400).json(DEAD_LINK);
  }

  /*
    The ceremony retires the browser screen it is replacing — never the
    hardware beside it (047).

    Unscoped, this update untrusted every trusted row in the archive, which
    after 047 includes any Recall device. A family asking to move Recall to a
    new laptop would have silently switched off the display in the living
    room, and nothing in the ceremony would have said so.
  */
  const { error: retireError } = await supabase
    .from("installations")
    .update({ is_trusted: false, revoked_at: new Date().toISOString() })
    .eq("archive_id", family.archive_id)
    .eq("is_trusted", true)
    .eq("is_recall_device", false);
  if (retireError) return fail(res, 500, "The screen could not be replaced.", retireError);

  return becomeFamilyScreen(req, res, family.archive_id);
});

/**
 * The chooser: who lives in this family.
 *
 * A password alone gets you this list and no further, so it says as little as
 * a front door does — a first name and a face. The subject is deliberately
 * absent: her profile exists only on the trusted device, so from a phone in
 * another city there is nothing to select.
 */
familyRouter.get("/profiles", async (req, res) => {
  const session = await currentSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });

  /*
   * The family is read before the session's claim to one is trusted (M77).
   *
   * Scoping the people query to `session.archiveId` returns zero rows for two
   * completely different situations: a living family whose members have not
   * chosen PINs yet, and a family that no longer exists. The chooser then
   * says "Nobody in this family has a PIN yet" — a confident sentence about
   * a family it never actually read.
   *
   * A session that cannot resolve its family is not a session, so it fails
   * closed with the same 401 as no session at all, and the chooser lands on
   * the login page like any other ending.
   */
  const { data: archive } = await supabase
    .from("archives")
    .select("id")
    .eq("id", session.archiveId)
    .maybeSingle();

  if (!archive) return res.status(401).json({ error: "Sign in first." });

  const { data, error } = await supabase
    .from("people")
    .select("id, name, relationship, role, profile_picture_path, pin_hash, locked_until")
    .eq("archive_id", session.archiveId)
    .eq("status", "active")
    .is("archived_at", null)
    .neq("role", "user")
    .order("created_at");

  if (error) return fail(res, 500, "The profiles could not be loaded.", error);

  /*
   * The display's own label, for the pre-auth pill (M146).
   *
   * It rides on the chooser because the chooser is the only call an
   * un-elevated family session may make — the elevation gate closed
   * `/screen-state` to it. The name only: what is playing on her screen
   * right now is a fact about her, and it stays behind the gate.
   */
  const { data: screens } = await supabase
    .from("installations")
    .select("name, is_trusted, revoked_at")
    .eq("archive_id", session.archiveId)
    .eq("is_trusted", true)
    .limit(1);

  const screen = (screens ?? []).find((row) => row.is_trusted === true && !row.revoked_at);

  res.json({
    display_name: (screen?.name as string | null) ?? null,
    profiles: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      // A fact about the family, like the role — not a contact detail (M108).
      relationship: p.relationship ?? null,
      role: p.role,
      /*
       * The face this screen was always meant to show.
       *
       * This said `has_photo: true` and stopped there — the chooser knew a
       * photograph existed and drew initials anyway, so people who had
       * uploaded a picture of themselves were represented by a letter. The
       * stable backend URL rather than a signed one, like every other media
       * URL the browser is handed (dto.ts): it does not expire, and the
       * private storage path stays on the server. `/media/person/:id/photo`
       * is reachable by a family session through requireDevice's M40
       * fallback and is scoped to the caller's own archive, so this hands
       * out nothing the session could not already fetch.
       */
      photo_url: p.profile_picture_path
        ? `${env.publicUrl}/api/media/person/${p.id}/photo`
        : null,
      // Whether a PIN is needed, never whether one is set to something.
      locked: !!p.locked_until && new Date(p.locked_until).getTime() > Date.now(),
      // A profile that has never been claimed cannot be entered remotely.
      claimable: !!p.pin_hash,
    })),
  });
});

/** Choosing a profile: the PIN is what says who you are. */
familyRouter.post("/profiles/:id/enter", loginLimiter, async (req, res) => {
  const session = await currentSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });

  const { pin } = req.body ?? {};
  if (!isValidPinFormat(pin)) return res.status(400).json({ error: "Enter your 6-digit PIN." });

  const { data: person } = await supabase
    .from("people")
    .select("id, name, role, pin_hash, failed_pin_attempts, locked_until, status, archived_at")
    .eq("id", req.params.id)
    // Scoped: a profile id from another family is simply not found here.
    .eq("archive_id", session.archiveId)
    .maybeSingle();

  if (!person || person.archived_at || person.status !== "active") {
    return res.status(404).json({ error: "That profile is not available." });
  }
  if (person.role === "user") {
    // The subject exists only on the trusted device, by design.
    return res.status(403).json({ error: "That profile is only available on the family screen." });
  }
  if (isLocked(person.locked_until)) {
    return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  }
  // Never opened without a PIN, whatever the role (access-3): a profile
  // promoted from `user` has none until one is minted for it.
  if (!person.pin_hash) {
    return res.status(403).json({ error: "This profile has not been claimed yet." });
  }

  const check = await checkPin(person.pin_hash, pin);
  if (!check.ok) {
    // One database move (037): the increment and the lockout decision happen
    // in a single UPDATE, so two wrong guesses arriving together cannot read
    // the same count and overwrite each other's attempt — and since 064 each
    // consecutive lock doubles the next. A failure that could not be counted
    // is not answered like a counted one — free guesses are exactly what the
    // counter exists to prevent — so this fails closed.
    const counted = await recordPinFailure(person, session.archiveId);
    if (!counted) {
      return fail(res, 503, "Verification is not possible right now.", { person: person.id });
    }
    return res.status(401).json({ error: "That PIN is not right." });
  }

  // The counters start again, and a PIN from before the pepper is re-hashed.
  await clearPinFailures(person.id, session.archiveId, check.legacy ? { pin } : null);

  const elevated = await elevateSession(res, session, {
    id: person.id,
    role: person.role as "admin" | "co_author",
  });
  if (!elevated) return fail(res, 500, "Could not open that profile.", { person: person.id });

  res.json({
    ok: true,
    person: { id: person.id, name: person.name, role: person.role },
    redirect_to: LANDING_PATH[person.role as "admin" | "co_author"],
  });
});

// ───────────────────────────────────────────────────────────────── sign out

familyRouter.post("/logout", async (req, res) => {
  const session = await currentSession(req);
  const revoked = session ? await revokeSession(session.id) : true;
  clearFamilyCookie(res);
  if (!revoked) {
    return res.status(503).json({ error: "Sign-out could not be completed. Please try again." });
  }
  res.json({ ok: true });
});

/**
 * Every browser, everywhere, at once.
 *
 * Revoking the opaque `family_sessions` was only ever a third of the promise
 * (M161): the `recall_device` and `recall_profile` JWT tiers are stateless
 * and outlived it, so a departed member's phone kept working after an admin
 * pressed this. Stamping `sessions_valid_from` is what makes the guards
 * refuse those tokens too — a device or profile cookie minted before this
 * moment is now stale. The trusted screen is exempt in `requireDevice`
 * exactly as it is for a reset (M29, owner's call), so Margaret's display
 * keeps playing while every remote key dies.
 */
familyRouter.post("/logout-everywhere", async (req, res) => {
  const session = await currentSession(req);
  if (!session) return res.status(401).json({ error: "Sign in first." });
  if (session.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can do that." });
  }

  /*
   * The stamp lands FIRST, and it bumps the version too (F62/F63).
   *
   * Order is the fix. Revoking the opaque rows first was irreversible: if the
   * cutoff write then failed — PGRST204 in the pre-042 window, or an outage —
   * the JWT tiers survived while the caller's own session was already gone, so
   * the retry died at the door (401) and the button was a one-shot that
   * half-worked. Writing the family row first means a failure here changes
   * nothing and is retryable in place. And `session_version` bumps alongside
   * `sessions_valid_from` (migration 027 says this button does): the opaque
   * tier then dies by version mismatch even if the row-level revoke below
   * times out — the suspenders to that belt.
   */
  const { data: family, error: readError } = await supabase
    .from("families")
    .select("session_version")
    .eq("id", session.familyId)
    .maybeSingle();
  // Fail closed and retryable: a discarded read error would fall through to
  // `?? 1` and write version 2 regardless of the real value, which could
  // resurrect a stale opaque row that happens to carry version 2. Refuse
  // instead — nothing has been written yet.
  if (readError || !family) {
    return fail(res, 500, "Could not sign everyone out. Try again.", readError ?? { message: "no family row" });
  }

  const { error } = await supabase
    .from("families")
    .update({
      sessions_valid_from: new Date().toISOString(),
      session_version: family.session_version + 1,
    })
    .eq("id", session.familyId);
  // Fail closed and retryable: nothing irreversible has happened yet.
  if (error) return fail(res, 500, "Could not sign everyone out. Try again.", error);

  // The belt: revoke the opaque rows. A failure here is logged, not fatal —
  // the version bump above already invalidated every old opaque cookie.
  await revokeAllSessions(session.familyId);

  clearFamilyCookie(res);
  res.json({ ok: true });
});

/** Who am I, if anyone. Used by the frontend to decide what to render. */
familyRouter.get("/me", async (req, res) => {
  const session = await currentSession(req);
  if (!session) return res.json({ signed_in: false });

  if (!session.personId) return res.json({ signed_in: true, chose_profile: false });

  const { data: person } = await supabase
    .from("people")
    .select("id, name, role")
    .eq("id", session.personId)
    .eq("archive_id", session.archiveId)
    .maybeSingle();

  res.json({
    signed_in: true,
    chose_profile: true,
    person: person ? { id: person.id, name: person.name, role: person.role } : null,
  });
});

/*
 * What is owed, for the workspace (055). Any signed-in member of the family
 * may read it — a phone with a family session, or the kiosk with a profile
 * unlocked — because the notice it feeds sits in the shell every member
 * sees. The display alone (device cookie, nobody at the keyboard) is
 * refused: her screen has no use for an invoice.
 */
familyRouter.get("/payment", async (req, res) => {
  const profile = await actingProfile(req);
  if (!profile?.archiveId) return res.status(401).json({ error: "Authentication required." });

  const { data, error } = await supabase
    .from("families")
    .select(FAMILY_PAYMENT_COLUMNS)
    .eq("archive_id", profile.archiveId)
    .maybeSingle();
  if (error) return fail(res, 500, "The account could not be read.", error);
  if (!data) return res.json(null);

  const row = data as unknown as { invoiced_at: string | null } & Record<string, unknown>;
  res.json({
    ...row,
    // 14 days to pay (terms §04); the workspace counts down from this.
    due_at: row.invoiced_at ? new Date(Date.parse(row.invoiced_at) + 14 * 86_400_000).toISOString() : null,
  });
});

// ───────────────────────────────────────────────────────────────── recovery

/**
 * The family email is the root of recovery: it owns the subscription, resets
 * the password and any member's PIN, and can re-run the trusted-device
 * ceremony. If everyone forgets everything, this inbox is what saves the
 * archive.
 *
 * The answer is identical whether or not the address belongs to a family.
 */
familyRouter.post("/recover", loginLimiter, async (req, res) => {
  const { email } = req.body ?? {};
  const answer = {
    ok: true,
    message: "If that address belongs to a family, we have sent the next step.",
  };
  if (typeof email !== "string" || !EMAIL_SHAPE.test(email.trim())) return res.json(answer);

  /*
   * Found by exact address, ignoring case — and mailed to the address on the
   * row (input-1 / authn-1 / database-1).
   *
   * The lookup handed the typed address to ilike raw, so `_` and `%` were
   * wildcards: `j_n@example.com` found the family at `jan@example.com`, and the reset link
   * then went to the address as typed — the caller's own inbox. One request
   * took over a family's password, or the platform owner's. Now the address
   * must match exactly, and the link only ever goes where /replace-screen's
   * does: the family's own inbox.
   */
  const pattern = exactIlike(email.trim().toLowerCase());
  if (!pattern) return res.json(answer);

  const { data: family } = await supabase
    .from("families")
    .select("id, email, display_name")
    .ilike("email", pattern)
    .maybeSingle();

  if (!family || !family.email) return res.json(answer);

  const token = mintSecret();
  await supabase.from("family_recovery_tokens").insert({
    family_id: family.id,
    token_hash: hashRecoveryToken(token),
    purpose: "password",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });

  await sendFamilyRecoveryEmail(family.email, family.display_name ?? "there", token);
  res.json(answer);
});

/**
 * Setting a new password consumes the token and revokes every remote session
 * in the same breath — a reset that leaves the old sessions alive has not
 * recovered anything.
 */
familyRouter.post("/recover/complete", loginLimiter, async (req, res) => {
  const { token, password } = req.body ?? {};
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (typeof token !== "string" || !token) {
    return res.status(400).json({ error: "That link is not valid any more." });
  }

  /*
   * One transaction (037): consuming the token, setting the password and
   * revoking every remote session complete together or not at all. The old
   * shape consumed the token first and set the password second, and a failure
   * between them cost the family a valid link — spent, with nothing to show
   * for it. Now a failure anywhere rolls the token back too, so the link in
   * the inbox stays good to try again.
   */
  const { data, error } = await supabase.rpc("recover_family_password", {
    p_token_hash: hashRecoveryToken(token),
    p_password_hash: await hashPassword(password),
  });

  if (error) return fail(res, 500, "The password could not be set.", error);

  const familyId = (Array.isArray(data) ? data[0] : data) as string | null | undefined;
  if (!familyId) return res.status(400).json({ error: "That link is not valid any more." });

  /*
   * Whoever read the family inbox has proved more than a password would, so
   * a lock left by somebody else's guessing (064) does not keep them out of
   * the password they just chose. Best-effort: the reset itself has landed.
   */
  const { error: unlockError } = await supabase
    .from("families")
    .update({ failed_password_attempts: 0, password_locked_until: null, password_lock_count: 0 })
    .eq("id", familyId);
  if (unlockError) console.error("[family] could not clear the password lock after recovery:", unlockError.message);

  clearFamilyCookie(res);
  // And a lock re-armed by the same guessing a minute later must not keep
  // them out either: this browser's next sign-in is checked past it.
  issueRecoveredCookie(res, familyId);

  res.json({ ok: true, next: "/login" });
});

/**
 * Choosing the family password for the first time, or changing it.
 *
 * Requires an admin profile — not merely a signed-in browser — because the
 * password is the key to everyone's door, and requires the current password
 * unless none has ever been set.
 */
familyRouter.post("/password", async (req, res) => {
  const session = await currentSession(req);
  if (!session || session.role !== "admin") {
    return res.status(403).json({ error: "Only an administrator can change the family password." });
  }

  const { current, password } = req.body ?? {};
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });

  const { data: family } = await supabase
    .from("families")
    .select("id, password_hash, session_version, password_locked_until")
    .eq("id", session.familyId)
    .maybeSingle();
  if (!family) return res.status(404).json({ error: "Family not found." });

  /*
   * The same lockout as the sign-in doors (064). A session left open is a
   * place to guess the current password from too, and a right guess here
   * rotates the password out from under the family. While locked the
   * password is not checked, and one sentence covers both answers.
   */
  if (family.password_hash) {
    const refused = {
      error: "That is not the current password, or there were too many attempts. Wait a little and try again.",
    };
    // Claimed before it is checked, like the sign-in doors, so guesses sent
    // together cannot all be checked before the lock lands. The update below
    // resets the count a right answer claimed.
    const claim = await claimPasswordAttempt(family.id);
    if (!(claim ?? !passwordLocked(family))) return res.status(401).json(refused);
    if (typeof current !== "string" || !(await verifyPassword(family.password_hash, current))) {
      return res.status(401).json(refused);
    }
  }

  const { error } = await supabase
    .from("families")
    .update({
      password_hash: await hashPassword(password),
      password_set_at: new Date().toISOString(),
      session_version: family.session_version + 1,
      // A new password starts with a clean count.
      failed_password_attempts: 0,
      password_locked_until: null,
      password_lock_count: 0,
    })
    .eq("id", family.id);

  if (error) return fail(res, 500, "The password could not be changed.", error);

  // Everyone signs in again, including whoever just changed it — a departed
  // member who knew the old password is the reason this exists.
  await revokeAllSessions(family.id);
  clearFamilyCookie(res);

  res.json({ ok: true, message: "Password changed. Everyone will sign in again." });
});
