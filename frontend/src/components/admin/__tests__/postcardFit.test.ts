import { describe, expect, it } from "vitest";
import { fitOneFace, fitBothFaces } from "../PostcardPreview";

/**
 * The postcard is drawn at a fixed 620×440 and scaled. A scale that is too
 * large for its column does not clip — it pushes the whole page sideways,
 * which on a phone reads as loose layout rather than as a bug, and on the
 * kiosk breaks the one rule that page has (it never scrolls).
 *
 * So the rule is asserted at the widths the product actually meets, in both
 * directions: never wider than the column, and never smaller than it needs to
 * be. A fitter that returned 0.01 everywhere would satisfy "fits" perfectly.
 */

/* 390 phone, minus the admin frame's own horizontal padding. */
const PHONE_COLUMN = 350;
const TABLET_COLUMN = 700;
const DESKTOP_COLUMN = 900;

describe("one face fits its column", () => {
  it("never overflows, at any width the product meets", () => {
    for (const width of [280, PHONE_COLUMN, 420, TABLET_COLUMN, DESKTOP_COLUMN, 1200]) {
      const rendered = 620 * fitOneFace(width, 0.62);
      // The epsilon is float drift on `620 * (w / 620)`, not slack in the
      // rule — a sub-nanometre overhang is not a layout fact.
      expect(rendered, `${width}px column`).toBeLessThanOrEqual(width + 1e-6);
    }
  });

  it("uses the caller's scale once there is room, so desktop is unchanged", () => {
    // 0.62 needs 385px. A desktop column has it; the scale must not creep up.
    expect(fitOneFace(DESKTOP_COLUMN, 0.62)).toBe(0.62);
    expect(fitOneFace(384.4, 0.62)).toBe(0.62);
  });

  it("shrinks rather than overflowing when the column is narrower", () => {
    expect(fitOneFace(PHONE_COLUMN, 0.62)).toBeLessThan(0.62);
    expect(620 * fitOneFace(PHONE_COLUMN, 0.62)).toBeCloseTo(PHONE_COLUMN, 5);
  });

  /* The direction a fitter fails silently: shrinking is always "safe", so a
     broken one looks fine. This is the assertion that catches it. */
  it("does not shrink further than it has to", () => {
    expect(fitOneFace(DESKTOP_COLUMN, 0.62)).toBeGreaterThan(0.5);
  });
});

describe("both faces fit, side by side or stacked", () => {
  it("never overflows in either arrangement", () => {
    for (const width of [280, PHONE_COLUMN, 500, TABLET_COLUMN, DESKTOP_COLUMN, 1400]) {
      const { scale, stacked } = fitBothFaces(width, 0.58);
      const needed = stacked ? 700 * scale : 1356 * scale;
      expect(needed, `${width}px column, stacked=${stacked}`).toBeLessThanOrEqual(width + 1e-6);
    }
  });

  it("stacks on a phone — 18l's 'minus the second column'", () => {
    expect(fitBothFaces(PHONE_COLUMN, 0.58).stacked).toBe(true);
  });

  it("keeps them side by side on a desktop column", () => {
    expect(fitBothFaces(DESKTOP_COLUMN, 0.58).stacked).toBe(false);
    expect(fitBothFaces(DESKTOP_COLUMN, 0.58).scale).toBe(0.58);
  });

  /* A stacked phone card must still be big enough to be worth showing: the
     number is the loudest thing on it (18l) and that only holds at size. */
  it("gives a stacked phone card a readable width", () => {
    const { scale } = fitBothFaces(PHONE_COLUMN, 0.58);
    expect(620 * scale).toBeGreaterThan(260);
  });

  it("crosses over exactly at the legibility floor, not somewhere near it", () => {
    // 1356 * 0.42 = 569.52 — the narrowest column that still shows two faces.
    expect(fitBothFaces(569.52, 1).stacked).toBe(false);
    expect(fitBothFaces(569.5, 1).stacked).toBe(true);
  });
});
