/**
 * The trusted screen's renewal window (056, owner's numbers, 17 Sep 2026):
 * 90 days standard, a 14-day advance notice, never an enforcement date — her
 * screen keeps playing whether or not anyone acts on it.
 *
 * Pulled out of ScreensBlock's RenewalBanner so the date arithmetic is
 * testable the way this codebase tests date/layout logic (postcardFit.test.ts):
 * a pure function, not a rendered component.
 */

export const RENEWAL_NOTICE_DAYS = 14;

export interface RenewalStatus {
  /** Whether the banner should show at all — false outside the 14-day window. */
  visible: boolean;
  /** Past its renewal date. Still never a restriction — the screen keeps playing. */
  overdue: boolean;
  /** e.g. "17 September" — the locale-formatted date to show. */
  dueLabel: string;
}

export function renewalStatus(sessionExpiresAt: string | null, now = new Date()): RenewalStatus | null {
  if (!sessionExpiresAt) return null;
  const dueMs = Date.parse(sessionExpiresAt);
  if (Number.isNaN(dueMs)) return null;

  const daysLeft = Math.ceil((dueMs - now.getTime()) / 86_400_000);
  const visible = daysLeft <= RENEWAL_NOTICE_DAYS;
  const dueLabel = new Date(dueMs).toLocaleDateString("en-GB", { day: "numeric", month: "long" });

  return { visible, overdue: daysLeft < 0, dueLabel };
}
