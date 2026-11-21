import { describe, expect, it } from "vitest";
import { renewalStatus } from "../renewal";

/**
 * The renewal window is a courtesy, never a restriction (056): visible only
 * inside 14 days of the date, and it must say so accurately whether that
 * date is still ahead or already passed — the wording differs, the screen
 * never does.
 */

const NOW = new Date("2026-09-17T12:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("renewalStatus", () => {
  it("is null with no date at all — nothing to show", () => {
    expect(renewalStatus(null, NOW)).toBeNull();
  });

  it("is invisible more than 14 days out", () => {
    expect(renewalStatus(days(15), NOW)).toMatchObject({ visible: false });
    expect(renewalStatus(days(90), NOW)).toMatchObject({ visible: false });
  });

  it("becomes visible at exactly 14 days out, not overdue", () => {
    expect(renewalStatus(days(14), NOW)).toMatchObject({ visible: true, overdue: false });
  });

  it("stays visible and not-overdue right up to the date", () => {
    expect(renewalStatus(days(1), NOW)).toMatchObject({ visible: true, overdue: false });
    expect(renewalStatus(days(0), NOW)).toMatchObject({ visible: true, overdue: false });
  });

  it("flips to overdue the moment the date has passed, and stays visible", () => {
    expect(renewalStatus(days(-1), NOW)).toMatchObject({ visible: true, overdue: true });
    expect(renewalStatus(days(-90), NOW)).toMatchObject({ visible: true, overdue: true });
  });

  it("formats the due date without the year", () => {
    const status = renewalStatus(days(10), NOW);
    expect(status?.dueLabel).toBe("27 September");
  });

  it("an unparsable date is treated as nothing to show", () => {
    expect(renewalStatus("not-a-date", NOW)).toBeNull();
  });
});
