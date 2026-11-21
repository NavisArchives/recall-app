import { describe, expect, it } from "vitest";
import { DESIGN_H, DESIGN_W, HEADER_PX, fromTop, px } from "../designSpace";

/**
 * The converter every number on Margaret's screens passes through.
 *
 * Spec 24 gives placement in design pixels and one instruction for using
 * them: `px ÷ 14.4 = vw`. If this is wrong, it is wrong *everywhere* and in
 * a way that looks deliberate — a screen uniformly 4% too big reads as a
 * design choice, not a bug, so nobody goes looking for arithmetic.
 */
describe("the spec's own worked examples", () => {
  it("converts the three the spec writes out itself", () => {
    // "e.g. 76px ≈ 5.28vw, 56px → 3.89vw, 20px → 1.39vw"
    expect(px(76)).toBe("5.278vw");
    expect(px(56)).toBe("3.889vw");
    expect(px(20)).toBe("1.389vw");
  });

  it("puts the full frame at exactly 100vw", () => {
    expect(px(DESIGN_W)).toBe("100.000vw");
  });

  it("is the frame the mockups were drawn in", () => {
    expect(DESIGN_W).toBe(1440);
    expect(DESIGN_H).toBe(810);
    // 16:9 — the whole reason vertical sizes may be expressed in vw.
    expect(DESIGN_W / DESIGN_H).toBeCloseTo(16 / 9, 5);
  });
});

describe("a spec y becomes an offset below the header", () => {
  /*
    The spec measures from the top of the frame; a page is rendered below the
    header and measures from its own top. Forgetting the difference does not
    crash anything — it silently pushes every screen 162px down, which on a
    display that never scrolls means the contributor's face leaves the panel.
  */
  it("subtracts the header before converting", () => {
    expect(HEADER_PX).toBe(162);
    expect(fromTop(238)).toBe(px(238 - 162));
    expect(fromTop(262)).toBe(px(100));
  });

  it("is not the same as a raw conversion", () => {
    expect(fromTop(238)).not.toBe(px(238));
  });
});
