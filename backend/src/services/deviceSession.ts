import { supabase } from "../config/supabase.js";
import { sendScreenRenewalEmail } from "./email.js";

/**
 * The renewal cadence for the one trusted screen (056, owner's numbers,
 * 17 Sep 2026): 90 days standard, the admin renews from the workspace
 * before it ever lapses, a 14-day advance notice, admin-only.
 *
 * This is a reminder layer, not an enforcement one. Her screen's own JWT is
 * signed for over a year (middleware/auth.ts's DEVICE_TTL_SECONDS) and
 * `deviceGuard` never refuses a trusted, non-revoked screen for being past
 * `session_expires_at` — nothing here can blank her display. What this
 * drives is purely the admin-only banner and the one email nudge per cycle.
 */
export const RENEWAL_PERIOD_DAYS = 90;
export const RENEWAL_NOTICE_DAYS = 14;

export function renewalDeadline(from = new Date()): string {
  return new Date(from.getTime() + RENEWAL_PERIOD_DAYS * 86_400_000).toISOString();
}

/** Whether a trusted screen is inside the admin's advance-notice window (past due counts). */
export function needsRenewalNotice(sessionExpiresAt: string | null): boolean {
  if (!sessionExpiresAt) return false;
  const daysLeft = (Date.parse(sessionExpiresAt) - Date.now()) / 86_400_000;
  return daysLeft <= RENEWAL_NOTICE_DAYS;
}

/**
 * Sends the one-per-cycle email nudge, opportunistically.
 *
 * There is no job runner in this codebase, and the sweep's own finding was
 * that the DURABLE signal must be the workspace banner, with email as a
 * courtesy that may simply be late — so this piggybacks on GET
 * /settings/screens, which an admin's browser calls every time Devices or
 * Settings loads. `renewal_notified_at` gates it to once per
 * `session_expires_at` value, cleared by `renewScreen` below. Always
 * fire-and-forget: a failed or skipped notice must never fail the read that
 * triggered it.
 */
export async function maybeNotifyRenewal(
  archiveId: string,
  screen: { id: string; session_expires_at: string | null; renewal_notified_at: string | null },
  familyEmail: string,
  familyName: string
): Promise<void> {
  if (!needsRenewalNotice(screen.session_expires_at)) return;
  if (screen.renewal_notified_at) return; // already notified for this cycle

  const { error } = await supabase
    .from("installations")
    .update({ renewal_notified_at: new Date().toISOString() })
    .eq("id", screen.id)
    .eq("archive_id", archiveId)
    .is("renewal_notified_at", null); // last-writer-wins guard: send once

  if (error) {
    console.error("[deviceSession] could not stamp the renewal notice:", error.message);
    return;
  }

  try {
    await sendScreenRenewalEmail(familyEmail, familyName, screen.session_expires_at as string);
  } catch (err) {
    console.error("[deviceSession] renewal email failed:", err);
  }
}

/** Bumps the trusted screen's renewal date and re-arms the next notice cycle. */
export async function renewScreen(archiveId: string) {
  return supabase
    .from("installations")
    .update({ session_expires_at: renewalDeadline(), renewal_notified_at: null })
    .eq("archive_id", archiveId)
    .eq("is_trusted", true)
    .is("revoked_at", null)
    .select("id, session_expires_at")
    .maybeSingle();
}
