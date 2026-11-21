import { describe, expect, it } from "vitest";
import { fitsKiosk, isHandheld, subscribeToFit, type ResizeSource } from "../kioskFit";

/**
 * M192 — the two rules, pinned separately, because the whole finding is that
 * they are two.
 *
 * The cases below are real devices at real sizes, not round numbers chosen
 * to make a threshold look tidy. The one that matters most is the iPhone in
 * landscape: it is the case that proves a viewport test cannot carry the
 * owner's law, and any future attempt to collapse these back into one rule
 * will fail on it.
 */

const phone = (narrow: number) => ({ coarsePointer: true, narrowSide: narrow, uaMobile: null });
const tablet = (narrow: number) => ({ coarsePointer: true, narrowSide: narrow, uaMobile: null });
const desktop = { coarsePointer: false, narrowSide: 1080, uaMobile: null };

describe("the law: a phone is never the family screen", () => {
  it("refuses every phone, in either orientation", () => {
    // iPhone SE, 13/14, 14 Pro Max. The short edge is the same number
    // whichever way it is held, which is the point of measuring it.
    for (const narrow of [375, 390, 430]) {
      expect(isHandheld(phone(narrow))).toBe(true);
    }
  });

  /*
   * The case the mission turns on.
   *
   * 844 × 390 was measured clipping nothing on the display route — it
   * renders correctly. A rule made of viewport pixels therefore admits it,
   * and it is still a phone. This is why the law reads the screen's narrow
   * side rather than the window's.
   */
  it("still refuses a phone in landscape, which renders perfectly", () => {
    expect(fitsKiosk({ width: 844, height: 390 })).toBe(false); // by height, incidentally
    expect(isHandheld(phone(390))).toBe(true); // by what it is, decisively
  });

  it("admits the tablets, which are what a family might reasonably use", () => {
    // iPad mini, iPad, iPad Pro — all three measured clean.
    for (const narrow of [744, 810, 1024]) {
      expect(isHandheld(tablet(narrow))).toBe(false);
    }
  });

  it("admits an ordinary computer", () => {
    expect(isHandheld(desktop)).toBe(false);
  });

  it("believes the browser when it answers the question directly", () => {
    // userAgentData.mobile is the browser stating it, and it is allowed to
    // overrule a size heuristic in the direction of refusing.
    expect(isHandheld({ coarsePointer: true, narrowSide: 1024, uaMobile: true })).toBe(true);
    // But `false` must not *admit* — iPadOS reports a desktop identity, and
    // a touchscreen laptop is not a phone anyway. The size test still runs.
    expect(isHandheld({ coarsePointer: true, narrowSide: 390, uaMobile: false })).toBe(true);
  });

  /*
   * A touchscreen is not a phone. Without the size term this would refuse a
   * Surface, an iPad, and any touch monitor a family might mount on a wall —
   * which is exactly the device the product is *for*.
   */
  it("does not refuse a machine merely for having a touchscreen", () => {
    expect(isHandheld({ coarsePointer: true, narrowSide: 1080, uaMobile: null })).toBe(false);
  });
});

describe("the floor: is there room to draw the display", () => {
  /*
   * Measured, not assumed. At 500 × 400 the display's `MAIN` clips 55px of
   * its own content — a figure reproduced independently after Feedback
   * reported it. At 640 × 640 nothing clips.
   */
  it("refuses the box that was measured clipping", () => {
    expect(fitsKiosk({ width: 500, height: 400 })).toBe(false);
  });

  it("admits the smallest box measured clean", () => {
    expect(fitsKiosk({ width: 640, height: 640 })).toBe(true);
  });

  it("refuses a shrunken desktop window, which no device test would catch", () => {
    // The mirror of the landscape phone: not a phone, still cannot draw.
    expect(isHandheld({ coarsePointer: false, narrowSide: 1080, uaMobile: null })).toBe(false);
    expect(fitsKiosk({ width: 600, height: 500 })).toBe(false);
  });

  it("admits an ordinary laptop", () => {
    expect(fitsKiosk({ width: 1366, height: 768 })).toBe(true);
  });

  /*
   * The two rules must be independently load-bearing. If either could be
   * deleted without a case changing its answer, it was never a second rule —
   * it was decoration on the first.
   */
  it("neither rule can stand in for the other", () => {
    // Passes the floor's job on its own terms, refused only by the law.
    const landscapePhone = { device: phone(390), view: { width: 844, height: 640 } };
    expect(fitsKiosk(landscapePhone.view)).toBe(true);
    expect(isHandheld(landscapePhone.device)).toBe(true);

    // Passes the law on its own terms, refused only by the floor.
    const smallWindow = { device: desktop, view: { width: 600, height: 500 } };
    expect(isHandheld(smallWindow.device)).toBe(false);
    expect(fitsKiosk(smallWindow.view)).toBe(false);
  });
});

/**
 * The subscription — the half that would be our fault if it were wrong.
 *
 * Four instruments could not fire a `resize` event: the browser pane changes
 * the viewport silently, and real Chrome in a background tab reports
 * `outerWidth: 0`, because a hidden tab is never laid out and so is never
 * resized. Rather than hunt a fifth, the claim is split at the seam between
 * our code and the platform's, and only our half is tested here.
 *
 * What is left over — "a browser fires `resize` when a window is resized" —
 * is a stated assumption, and a far smaller thing to assume than a whole
 * untested code path.
 */
describe("the floor follows the window", () => {
  function fakeWindow(width: number, height: number) {
    const listeners = new Set<() => void>();
    const source: ResizeSource = {
      innerWidth: width,
      innerHeight: height,
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    };
    return {
      source,
      listenerCount: () => listeners.size,
      resizeTo(w: number, h: number) {
        source.innerWidth = w;
        source.innerHeight = h;
        listeners.forEach((l) => l());
      },
    };
  }

  it("reports on subscribe, without waiting for an event", () => {
    // The window can change between first render and the effect running, so
    // an initial value taken at render time can already be stale.
    const win = fakeWindow(1280, 800);
    const seen: boolean[] = [];
    subscribeToFit(win.source, (fits) => seen.push(fits));
    expect(seen).toEqual([true]);
  });

  it("re-measures when a resize arrives, in both directions", () => {
    const win = fakeWindow(1280, 800);
    const seen: boolean[] = [];
    subscribeToFit(win.source, (fits) => seen.push(fits));

    win.resizeTo(600, 500); // the measured-clipping box
    win.resizeTo(1280, 800); // and back — the button must return

    expect(seen).toEqual([true, false, true]);
  });

  it("re-reads the numbers rather than trusting an earlier verdict", () => {
    // Starting below the floor and growing past it is the case a person
    // actually performs: they are told to make the window bigger, and do.
    const win = fakeWindow(500, 400);
    const seen: boolean[] = [];
    subscribeToFit(win.source, (fits) => seen.push(fits));
    expect(seen).toEqual([false]);

    win.resizeTo(640, 640);
    expect(seen).toEqual([false, true]);
  });

  it("stops listening when it is unsubscribed", () => {
    // A listener left behind would keep calling `setFits` on an unmounted
    // component — and would make the test above pass for the wrong reason
    // if it accumulated across subscriptions.
    const win = fakeWindow(1280, 800);
    const stop = subscribeToFit(win.source, () => {});
    expect(win.listenerCount()).toBe(1);
    stop();
    expect(win.listenerCount()).toBe(0);
  });
});
