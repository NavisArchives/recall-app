import argon2 from "argon2";
import { createHmac, randomInt } from "node:crypto";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { logActivity } from "./activityLog.js";

/**
 * Profile PINs (level 2).
 *
 * Six digits is a small space, so the protection comes from lockout rather
 * than length: a handful of wrong entries locks the profile for a while. That
 * suits a device sitting in a living room, where the realistic threat is
 * someone guessing a few times, not an offline attack.
 */
export const PIN_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
/*
 * The lockout doubles with each consecutive lock and stops here (064,
 * authn-8). A flat fifteen minutes reopened five fresh guesses every quarter
 * hour — about 480 a day against one profile, forever. Doubling from 15
 * minutes reaches the ceiling on the seventh lock, so a patient guesser gets
 * roughly 35 tries in the first day and five a day after that. A person who
 * simply forgot is reset the moment they get it right, or by an admin.
 */
export const LOCKOUT_CEILING_HOURS = 24;
/** From this many consecutive locks on, a lock is written to the family's activity. */
export const REPEATED_LOCK_NOTICE = 2;

export function generatePin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i++) pin += randomInt(10).toString();
  return pin;
}

export function isValidPinFormat(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(value);
}

/*
 * A server-side key in front of every PIN (SKEPTIC authn).
 *
 * Argon2 slows each guess, but a six-digit PIN has only a million of them: a
 * copy of `people.pin_hash` — a backup, a dump, a leaked service key — gave up
 * every admin's PIN in hours of offline work, and the lockout means nothing
 * offline. Hashing an HMAC of the PIN keyed with CODE_PEPPER, as lookup tokens
 * already are (familyAuth.ts), makes the stolen table worthless without the
 * server's secret too.
 */
function peppered(pin: string): string {
  return createHmac("sha256", env.codePepper).update(`pin:${pin}`).digest("hex");
}

export function hashPin(pin: string): Promise<string> {
  return argon2.hash(peppered(pin), { type: argon2.argon2id });
}

export interface PinCheck {
  ok: boolean;
  /**
   * True when the match was against a hash written before the pepper. The
   * caller re-hashes it with `hashPin` on this successful unlock, so every
   * PIN moves to the peppered form the next time its owner uses it.
   */
  legacy: boolean;
}

async function argonMatches(hash: string, candidate: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, candidate);
  } catch {
    return false;
  }
}

/**
 * The peppered form first, then the raw one written before 064.
 *
 * Lockout is unchanged: this answers one guess, and the caller counts it
 * exactly as before, whichever form the stored hash is in.
 */
export async function checkPin(hash: string, pin: string): Promise<PinCheck> {
  if (await argonMatches(hash, peppered(pin))) return { ok: true, legacy: false };
  if (await argonMatches(hash, pin)) return { ok: true, legacy: true };
  return { ok: false, legacy: false };
}

/**
 * The yes-or-no form of `checkPin`, for a caller that does not re-hash.
 * Kept boolean on purpose: an object here would be truthy for a wrong PIN.
 */
export async function verifyPin(hash: string, pin: string): Promise<boolean> {
  return (await checkPin(hash, pin)).ok;
}

/**
 * One wrong PIN, counted in the database (037, escalated by 064).
 *
 * The increment, the lock and its doubling happen in one UPDATE, so guesses
 * arriving together cannot overwrite each other's count. Returns null when
 * the failure could not be counted — the caller fails closed, because free
 * guesses are exactly what the counter exists to prevent.
 *
 * A profile that locks again and again is written to the family's activity,
 * which is what an admin reads: a flat lock nobody ever saw was the other
 * half of authn-8.
 */
export async function recordPinFailure(
  person: { id: string; name?: string | null },
  archiveId: string
): Promise<{ locked: boolean; lockCount: number } | null> {
  const { data, error } = await supabase.rpc("record_pin_failure", {
    p_person: person.id,
    p_archive: archiveId,
    p_max: MAX_FAILED_ATTEMPTS,
    p_lockout: `${LOCKOUT_MINUTES} minutes`,
    p_ceiling: `${LOCKOUT_CEILING_HOURS} hours`,
  });
  if (error) {
    console.error("[pins] could not count a failed PIN:", error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { locked?: boolean; lock_count?: number } | null;
  const locked = row?.locked === true;
  const lockCount = typeof row?.lock_count === "number" ? row.lock_count : 0;

  if (locked && lockCount >= REPEATED_LOCK_NOTICE) {
    const who = person.name?.split(" ")[0] ?? "A profile";
    // Filed under the profile it happened to, in its own archive: the feed
    // shows it beside that person, which is where an admin will look.
    logActivity(
      { personId: person.id, name: person.name ?? who, role: "co_author", archiveId },
      "profile_locked",
      `${who}'s profile was locked again after repeated wrong PINs (${lockCount} locks in a row). If that was not them, reset their PIN.`
    );
  }
  return { locked, lockCount };
}

/**
 * A right PIN: the counters start again, and a PIN still stored in the form
 * from before the pepper is re-hashed now that its owner has typed it.
 */
export async function clearPinFailures(
  personId: string,
  archiveId: string,
  rehash: { pin: string } | null,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const update: Record<string, unknown> = {
    failed_pin_attempts: 0,
    locked_until: null,
    pin_lock_count: 0,
    ...extra,
  };
  if (rehash) update.pin_hash = await hashPin(rehash.pin);
  const { error } = await supabase
    .from("people")
    .update(update)
    .eq("id", personId)
    .eq("archive_id", archiveId);
  if (error) console.error("[pins] could not reset the PIN counters:", error.message);
}

export function lockoutUntil(): string {
  return new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString();
}

export function isLocked(lockedUntil: string | null): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > Date.now();
}
