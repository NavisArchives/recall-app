import { describe, expect, it } from "vitest";
import { isCollapsed } from "../collapseGuard";

/**
 * M190 — the guard is calibrated against the bug that shipped.
 *
 * The PIN cells declared `max-w-[54px]` and rendered **3px**, live, on the
 * sign-in screen. Every width check was green because 3px fits. So the first
 * assertion here is not a hypothetical: it is that exact measurement, and if
 * it ever stops being a finding, the guard has stopped guarding.
 */
describe("the guard recognises the collapse that shipped", () => {
  it("calls the live PIN regression a collapse", () => {
    // The numbers Missions read off the deployed page.
    expect(
      isCollapsed({ rendered: 3, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 55 })
    ).toBe(true);
  });

  it("leaves the fixed row alone", () => {
    // What the same cells measure now, at 360px.
    expect(
      isCollapsed({ rendered: 41, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 286 })
    ).toBe(false);
  });

  it("leaves the desktop row alone", () => {
    expect(
      isCollapsed({ rendered: 54, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 500 })
    ).toBe(false);
  });
});

describe("it does not cry wolf", () => {
  /*
   * A guard that fires on ordinary pages gets muted, and a muted guard is
   * worse than none — so the states that merely *look* small must pass.
   */
  it("ignores a subtree that is not laid out at all", () => {
    // Hidden, unmounted, display:none — everything measures zero. That is
    // absence, not collapse, and it would bury every real finding.
    expect(isCollapsed({ rendered: 0, renderedHeight: 0, maxWidth: 54, flexGrow: 1, parentWidth: 0 })).toBe(false);
    expect(isCollapsed({ rendered: 0, renderedHeight: 0, maxWidth: 54, flexGrow: 1, parentWidth: 300 })).toBe(false);
  });

  it("ignores things that are genuinely meant to be tiny", () => {
    // A 2px caret, a 10px dot, a 1px divider: small on purpose, and none of
    // them asking for more.
    expect(isCollapsed({ rendered: 2, renderedHeight: 56, maxWidth: 2, flexGrow: 0, parentWidth: 300 })).toBe(false);
    expect(isCollapsed({ rendered: 10, renderedHeight: 56, maxWidth: 10, flexGrow: 0, parentWidth: 300 })).toBe(false);
    expect(isCollapsed({ rendered: 1, renderedHeight: 56, maxWidth: null, flexGrow: 0, parentWidth: 300 })).toBe(false);
  });

  it("treats a squeeze as a design question, not a bug", () => {
    // 40 against a wanted 54 is cramped; a person should decide that, not a
    // console. Only a fraction of what was asked for is a defect.
    expect(isCollapsed({ rendered: 40, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 260 })).toBe(false);
    expect(isCollapsed({ rendered: 20, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 140 })).toBe(false);
  });
});

describe("without a declared ceiling, growth is the statement of intent", () => {
  it("flags a fluid child rendering at a few pixels", () => {
    // No max-width, but told to take a share of the row — and the row had
    // no share to give.
    expect(isCollapsed({ rendered: 3, renderedHeight: 56, maxWidth: null, flexGrow: 1, parentWidth: 55 })).toBe(true);
  });

  it("says nothing about a fixed-size child that is simply small", () => {
    expect(isCollapsed({ rendered: 3, renderedHeight: 56, maxWidth: null, flexGrow: 0, parentWidth: 300 })).toBe(false);
  });
});

/**
 * M194 — the guard was only catching collapses that happened to be small.
 *
 * Feedback checked the guard rather than taking it: transcribed the function,
 * ran it against both commits' real markup, and found the pixel floor sitting
 * in front of the ratio. So the ratio only ever got to speak about elements
 * already under 12px, and anything bigger walked past however short it was.
 *
 * The sharp version, which is why this matters more than the numbers: **the
 * M189 cells were caught partly because they were small.** The same circular
 * width chain at panel or sidebar scale was invisible. Proportion is the
 * defect; size is not.
 */
describe("a collapse is a proportion, not a size", () => {
  it("catches a panel that rendered at a twentieth of its width", () => {
    // 30px against a declared 600 — 95% short, and previously silent.
    expect(isCollapsed({ rendered: 30, renderedHeight: 56, maxWidth: 600, flexGrow: 1, parentWidth: 800 })).toBe(true);
  });

  it("catches a control that rendered at a fourteenth of its width", () => {
    // 14px against a declared 200 — 93% short, and previously silent because
    // 14 is over the floor.
    expect(isCollapsed({ rendered: 14, renderedHeight: 56, maxWidth: 200, flexGrow: 1, parentWidth: 400 })).toBe(true);
  });

  it("still leaves a large element that merely fell short alone", () => {
    // 400 against 600 is a third short: a layout decision, not a collapse.
    expect(isCollapsed({ rendered: 400, renderedHeight: 56, maxWidth: 600, flexGrow: 1, parentWidth: 800 })).toBe(false);
  });

  /*
   * The limit, stated rather than discovered later: 6px against 54px is 11%,
   * just over the threshold, so it stays quiet. That is the ratio's call and
   * a deliberate one — the alternative is a guard that fires on squeezes and
   * gets muted, which costs more than this misses.
   */
  it("does not pretend to catch everything the ratio excludes", () => {
    expect(isCollapsed({ rendered: 6, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 60 })).toBe(false);
  });
});

/**
 * M198 (F79) — the completest collapse was the one it ignored.
 *
 * The guard skipped `rendered <= 0` outright, so an element 56px tall and
 * 0px wide said nothing at all: total absence of width read as absence of
 * the element. Reachable today — `PinInput`'s caret is not rendered when
 * the field is disabled or has succeeded, and the cells around it are
 * exactly the shape that starves.
 *
 * My first fix flagged every `display:none` node, because those measure
 * zero too and their parents have width. The existing assertion caught it
 * — which is what the assertion was for. Height is the discriminator: an
 * element that is laid out but starved still has its height; one that is
 * not laid out has neither.
 */
describe("zero width is the completest collapse, not an absence", () => {
  it("catches an element with height that rendered no width at all", () => {
    expect(
      isCollapsed({ rendered: 0, renderedHeight: 56, maxWidth: 54, flexGrow: 1, parentWidth: 300 })
    ).toBe(true);
  });

  it("catches it without a ceiling too, when it asked to grow", () => {
    expect(
      isCollapsed({ rendered: 0, renderedHeight: 56, maxWidth: null, flexGrow: 1, parentWidth: 300 })
    ).toBe(true);
  });

  it("still ignores a subtree that is not laid out in either direction", () => {
    // display:none, unmounted, hidden — zero by zero. Reporting these would
    // bury every real finding, which is how a guard gets muted.
    expect(
      isCollapsed({ rendered: 0, renderedHeight: 0, maxWidth: 54, flexGrow: 1, parentWidth: 300 })
    ).toBe(false);
  });

  it("says nothing about a zero-width element that never asked for width", () => {
    expect(
      isCollapsed({ rendered: 0, renderedHeight: 56, maxWidth: null, flexGrow: 0, parentWidth: 300 })
    ).toBe(false);
  });
});
