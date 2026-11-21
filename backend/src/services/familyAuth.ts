import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";

/**
 * The Family session — one household, signed in from anywhere.
 *
 * Implements `docs/specs/identity-model.md`. Two things make this different
 * from the device and profile cookies it sits beside:
 *
 * The cookie is **opaque**. It carries a random identifier and nothing else —
 * no role, no archive, no family. Those are read from the row on every
 * protected request, so deleting a member, changing a role, rotating the
 * password or signing out takes effect on the next request rather than
 * whenever a signed token happens to expire.
 *
 * The session is **two-stage**. The family password opens the profile
 * chooser and nothing more; the PIN is what says who you are. A password
 * alone can look at a list of first names, which is what the front door of a
 * house shows you too.
 */

export const FAMILY_COOKIE = "recall_family";

/** How long a signed-in browser stays signed in, before and after choosing. */
const CHOOSER_MINUTES = 20;
const REMOTE_HOURS = 8;

/** Six digits deserve a small door. Argon2id, and the same lockout as PINs. */
const PASSWORD_MIN = 10;

export interface FamilySession {
  id: string;
  familyId: string;
  archiveId: string;
  personId: string | null;
  role: "admin" | "co_author" | "user" | null;
}

/**
 * Session tokens are found by hash, so they cannot be salted per row; the
 * pepper is what makes a stolen `family_sessions` table useless on its own.
 * Same reasoning as the invitation codes, same key, separate domain.
 */
function hashToken(token: string): string {
  return createHmac("sha256", env.codePepper).update(`family-session:${token}`).digest("hex");
}

export function hashRecoveryToken(token: string): string {
  return createHmac("sha256", env.codePepper).update(`family-recovery:${token}`).digest("hex");
}

export function mintSecret(): string {
  return randomBytes(32).toString("base64url");
}

// ─────────────────────────────────────────────────────────── the password

export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "A password is required.";
  // Normalised before measuring, so an accented passphrase is not quietly
  // shorter than it looks.
  const password = value.normalize("NFKC");
  if (password.length < PASSWORD_MIN) {
    return `Use at least ${PASSWORD_MIN} characters — a phrase you will remember beats a puzzle you will not.`;
  }
  if (password.length > 512) return "That password is too long.";
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password.normalize("NFKC"), { type: argon2.argon2id });
}

/**
 * What gets verified when there is nothing to verify.
 *
 * When a login names no family, the route still runs a full verification so
 * "no such family" costs the same as "wrong password" — otherwise the timing
 * answers the question the response refuses to. This used to be a
 * hand-assembled string of x's and y's in argon2's format; if the library ever
 * rejected that shape during parsing it would return early, and the timing
 * side-channel this exists to close would quietly reopen. So it is a genuine
 * Argon2id digest of a random 32-byte secret that was generated once and
 * discarded — it parses like every real hash, runs the full computation, and
 * matches nothing.
 */
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$QZNbzlIEjS7dXGdQD/3Fsw$y2KTrHIx8bxC2SjynD5e+XQEsC5G66U6wBMVxWeBprs";

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password.normalize("NFKC"));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────── the password's own lockout

/*
 * A counter on the family row, not on the caller (064, authn-3 / edge-2).
 *
 * The per-IP limiter in front of the sign-in routes lives in one process's
 * memory, so an attacker with many addresses — or simply many Cloud Run
 * instances answering — met no limit on one family's password at all. The
 * count now lives in the database, shared by every instance. Ten wrong in a
 * row lock the password for fifteen minutes, doubling with each consecutive
 * lock up to a day; a right password resets both counts.
 *
 * Ten rather than the PIN's five because the password is typed by a whole
 * family, from memory, on phones — and a locked password strands everyone at
 * once. Her screen is never behind it: the display runs on its own device
 * cookie, so no lock here can blank it.
 */
export const MAX_PASSWORD_ATTEMPTS = 10;
export const PASSWORD_LOCKOUT_MINUTES = 15;
export const PASSWORD_LOCKOUT_CEILING_HOURS = 24;

/** Whether a family row's password is locked right now. */
export function passwordLocked(row: { password_locked_until?: string | null } | null): boolean {
  const until = row?.password_locked_until;
  return !!until && new Date(until).getTime() > Date.now();
}

/** A nil id: no family has it, so a claim made with it touches no row. */
export const NO_FAMILY = "00000000-0000-0000-0000-000000000000";

/**
 * Claims one attempt at a family's password BEFORE the password is checked
 * (064, `begin_family_password_attempt`).
 *
 * Counting after the check let a burst of guesses sent together all read the
 * row before the tenth failure landed, and every one of them was checked
 * against the real hash: the lock limited guesses in sequence, not guesses in
 * flight. Now each attempt is counted, and the lock decided, in one locked
 * statement first; only an attempt the database allowed is checked at all,
 * and a right password afterwards resets the count.
 *
 * It is made for every sign-in attempt, known address or not — with the nil
 * id when there is no family — so the two cost the same round trip and the
 * timing cannot say whether an address belongs to a family.
 *
 * Returns true when the attempt may be checked, false while the password is
 * locked, and null when the database could not decide (an error, or no row):
 * the caller then falls back on the lock it read with the row, as sign-in
 * did before 064's claim existed. That is never looser than the old rule,
 * and a counter fault does not strand a family.
 */
export async function claimPasswordAttempt(familyId: string | null): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("begin_family_password_attempt", {
    p_family: familyId ?? NO_FAMILY,
    p_max: MAX_PASSWORD_ATTEMPTS,
    p_lockout: `${PASSWORD_LOCKOUT_MINUTES} minutes`,
    p_ceiling: `${PASSWORD_LOCKOUT_CEILING_HOURS} hours`,
  });
  if (error) {
    console.error("[familyAuth] could not claim a password attempt:", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: unknown } | null | undefined;
  return typeof row?.allowed === "boolean" ? row.allowed : null;
}

/*
 * The way back in past somebody else's guessing.
 *
 * The lock counts failures against the family, whoever sends them, so anyone
 * who knows a family's address — or the platform owner's — can keep its
 * password locked with a handful of requests an hour. Recovery clears the
 * lock, but a lock re-armed seconds later stranded the person who had just
 * chosen a new password. So a completed recovery leaves this cookie behind:
 * signed, httpOnly, bound to the family, good for a day and only on the
 * family sign-in routes. A browser holding it has read the family inbox,
 * which proves more than any password, and its sign-in is checked against the
 * real password even while the lock stands. It buys one attempt: a wrong
 * password spends it.
 */
export const RECOVERED_COOKIE = "recall_recovered";
const RECOVERED_KIND = "family_recovered";
const RECOVERED_SECONDS = 24 * 60 * 60;
const RECOVERED_PATH = "/api/family";

function recoveredCookieOptions() {
  return { httpOnly: true, secure: env.isProduction, sameSite: "strict" as const, path: RECOVERED_PATH };
}

export function issueRecoveredCookie(res: Response, familyId: string): void {
  const token = jwt.sign({ kind: RECOVERED_KIND, familyId }, env.sessionSecret, {
    expiresIn: RECOVERED_SECONDS,
    algorithm: "HS256",
  });
  res.cookie(RECOVERED_COOKIE, token, { ...recoveredCookieOptions(), maxAge: RECOVERED_SECONDS * 1000 });
}

export function clearRecoveredCookie(res: Response): void {
  res.clearCookie(RECOVERED_COOKIE, recoveredCookieOptions());
}

/** The family this browser recovered within the last day, or null. */
export function recoveredFamily(req: Pick<Request, "cookies">): string | null {
  const token = req.cookies?.[RECOVERED_COOKIE];
  if (typeof token !== "string" || !token) return null;
  try {
    const claim = jwt.verify(token, env.sessionSecret, { algorithms: ["HS256"] }) as {
      kind?: unknown;
      familyId?: unknown;
    };
    if (claim?.kind !== RECOVERED_KIND || typeof claim.familyId !== "string") return null;
    return claim.familyId;
  } catch {
    return null;
  }
}

/**
 * One wrong password (or wrong second factor), counted in one UPDATE so
 * guesses arriving together cannot overwrite each other's count.
 *
 * A failure that could not be counted is logged, and the attempt is still
 * refused by the caller: answering it any differently would tell the caller
 * that this address belongs to a family, and the per-IP limiter still stands
 * in front of the route.
 */
export async function recordPasswordFailure(familyId: string): Promise<void> {
  const { error } = await supabase.rpc("record_family_password_failure", {
    p_family: familyId,
    p_max: MAX_PASSWORD_ATTEMPTS,
    p_lockout: `${PASSWORD_LOCKOUT_MINUTES} minutes`,
    p_ceiling: `${PASSWORD_LOCKOUT_CEILING_HOURS} hours`,
  });
  if (error) console.error("[familyAuth] could not count a failed password:", error.message);
}

/**
 * A right password: both counts start again. Skipped when the row as read
 * has nothing to clear — unless `claimed`: an attempt claimed first
 * (claimPasswordAttempt) changed the row after it was read, so it is always
 * undone.
 */
export async function clearPasswordFailures(
  row: {
    id: string;
    failed_password_attempts?: number | null;
    password_lock_count?: number | null;
    password_locked_until?: string | null;
  },
  { claimed = false }: { claimed?: boolean } = {}
): Promise<void> {
  if (!claimed && !row.failed_password_attempts && !row.password_lock_count && !row.password_locked_until) return;
  const { error } = await supabase
    .from("families")
    .update({ failed_password_attempts: 0, password_locked_until: null, password_lock_count: 0 })
    .eq("id", row.id);
  if (error) console.error("[familyAuth] could not reset the password counter:", error.message);
}

/**
 * Constant-time compare for the places two secrets meet in memory.
 */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// ─────────────────────────────────────────────────────────────── sessions

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * Opens a session for a family, before any profile is chosen.
 *
 * The identifier is rotated at every step that changes what the session can
 * do — logging in, choosing a profile, recovering — so a fixed identifier
 * planted before login is worthless after it.
 */
export async function openFamilySession(
  res: Response,
  family: { id: string; archive_id: string; session_version: number },
  meta: { userAgent?: string } = {}
): Promise<string | null> {
  const token = mintSecret();
  const expires = new Date(Date.now() + CHOOSER_MINUTES * 60_000);

  const { error } = await supabase.from("family_sessions").insert({
    family_id: family.id,
    archive_id: family.archive_id,
    token_hash: hashToken(token),
    session_version: family.session_version,
    expires_at: expires.toISOString(),
    user_agent: meta.userAgent?.slice(0, 200) ?? null,
  });
  if (error) {
    console.error("[family] could not open a session:", error.message);
    return null;
  }

  res.cookie(FAMILY_COOKIE, token, cookieOptions(CHOOSER_MINUTES * 60_000));
  return token;
}

/**
 * A profile was chosen and its PIN accepted: the session grows into one that
 * can do things, and gets a fresh identifier for the privilege.
 */
export async function elevateSession(
  res: Response,
  session: FamilySession,
  person: { id: string; role: "admin" | "co_author" | "user" }
): Promise<boolean> {
  const token = mintSecret();
  const expires = new Date(Date.now() + REMOTE_HOURS * 3_600_000);

  const { error } = await supabase
    .from("family_sessions")
    .update({
      token_hash: hashToken(token),
      person_id: person.id,
      role: person.role,
      expires_at: expires.toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("archive_id", session.archiveId)
    .is("revoked_at", null);

  if (error) {
    console.error("[family] could not elevate a session:", error.message);
    return false;
  }
  res.cookie(FAMILY_COOKIE, token, cookieOptions(REMOTE_HOURS * 3_600_000));
  return true;
}

/**
 * The inverse of `elevateSession`: whoever was chosen steps back out.
 *
 * On a remote session the identity *is* the stamp on this row — `/session`
 * reads the person from here when there is no profile cookie, which is the
 * only thing that names a family member signed in from their own phone. So
 * clearing the profile cookie alone left the server still answering with the
 * person you had just switched away from (M90).
 *
 * The session returns to exactly the state `openFamilySession` leaves it in:
 * the family is still signed in, nobody is chosen, and the clock is back to
 * the chooser's short scope rather than the eight hours a chosen person
 * earns. The identifier rotates, because it rotates at every step that
 * changes what the session can do, and this step subtracts.
 */
export async function demoteSession(res: Response, session: FamilySession): Promise<boolean> {
  const token = mintSecret();
  const expires = new Date(Date.now() + CHOOSER_MINUTES * 60_000);

  const { error } = await supabase
    .from("family_sessions")
    .update({
      token_hash: hashToken(token),
      person_id: null,
      role: null,
      expires_at: expires.toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("archive_id", session.archiveId)
    .is("revoked_at", null);

  if (error) {
    console.error("[family] could not step a session back to the chooser:", error.message);
    return false;
  }
  res.cookie(FAMILY_COOKIE, token, cookieOptions(CHOOSER_MINUTES * 60_000));
  return true;
}

/**
 * Reads the session behind a cookie, or null.
 *
 * Everything is re-checked here: the row is live, the family still exists,
 * the password has not been rotated underneath it, and — when a profile has
 * been chosen — that person is still active with the role the session claims.
 * The cookie is a claim; these rows are the truth.
 */
export async function readFamilySession(token: string | undefined): Promise<FamilySession | null> {
  if (!token) return null;

  const { data: row } = await supabase
    .from("family_sessions")
    .select("id, family_id, archive_id, person_id, role, session_version, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const { data: family } = await supabase
    .from("families")
    .select("id, archive_id, session_version, status")
    .eq("id", row.family_id)
    .maybeSingle();

  // A rotated password, a suspended family, or a family that no longer
  // exists all end the session here rather than at its natural expiry.
  if (!family || family.status !== "active") return null;
  if (family.session_version !== row.session_version) return null;
  if (family.archive_id !== row.archive_id) return null;

  let role = row.role as FamilySession["role"];
  if (row.person_id) {
    const { data: person } = await supabase
      .from("people")
      .select("id, role, status, archive_id, archived_at")
      .eq("id", row.person_id)
      .maybeSingle();

    if (!person || person.archived_at || person.status !== "active") return null;
    // The person must still belong to this family. A profile moved or
    // deleted must not keep answering for the session that named it.
    if (person.archive_id !== row.archive_id) return null;
    role = person.role as FamilySession["role"];
  }

  void supabase
    .from("family_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined);

  return {
    id: row.id,
    familyId: row.family_id,
    archiveId: row.archive_id,
    personId: row.person_id,
    role,
  };
}

/**
 * Ends whichever session row the presented cookie names — valid, expired,
 * version-bumped or suspended alike. The doors that re-decide what a browser
 * is (pairing, installation sign-in) use this instead of resolving first:
 * a stale key is evicted for being presented, not for being believable.
 */
export async function revokeSessionByToken(token: string): Promise<boolean> {
  const { error } = await supabase
    .from("family_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null);
  if (error) {
    console.error("[family] could not revoke presented session:", error.message);
    return false;
  }
  return true;
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  const { error } = await supabase
    .from("family_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("revoked_at", null);
  if (error) {
    console.error("[family] could not revoke session:", error.message);
    return false;
  }
  return true;
}

/** Sign out everywhere: every remote session for this family, at once. */
export async function revokeAllSessions(familyId: string): Promise<boolean> {
  const { error } = await supabase
    .from("family_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("family_id", familyId)
    .is("revoked_at", null);
  // Its siblings (elevate/demote) log their errors; this one swallowed them,
  // so a timeout on this multi-row write vanished (F62). It is a belt to the
  // session_version suspenders now, so a failure is logged, not silent.
  if (error) {
    console.error("[family] could not revoke every session:", error.message);
    return false;
  }
  return true;
}

export function clearFamilyCookie(res: Response): void {
  res.clearCookie(FAMILY_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}
