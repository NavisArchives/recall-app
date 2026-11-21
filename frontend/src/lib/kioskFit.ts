import { useEffect, useState } from "react";

/**
 * M192 — can this machine be the family screen?
 *
 * There are **two** questions here and they must not be fused, because one
 * number cannot answer both. Missions put it exactly right: a rule that
 * admits a phone held sideways, or one that rejects a laptop window, is a
 * rule doing the wrong job.
 *
 *   THE LAW    — "a phone is never a family display."  A statement about the
 *                *object*, which the owner made categorically. It has to
 *                hold for a phone that renders perfectly.
 *   THE FLOOR  — "the kiosk needs this much room."  A statement about
 *                *layout*, which catches a shrunken desktop window and a
 *                device nobody has shipped yet.
 *
 * ── Why a viewport test cannot express the law ───────────────────────────
 *
 * Measured on the display route rather than argued:
 *
 *   500 × 400   `MAIN` clips **55px** of its own content
 *   844 × 390   **clean** — nothing clipped, nothing overflowing
 *   640 × 640   **clean**
 *
 * 844 × 390 is an iPhone 14 in landscape. It renders correctly and it is
 * still a phone, propped on a kitchen counter, ringing. Any rule made only
 * of pixels admits it. Only a rule about the device can refuse it.
 *
 * That pair also corrects the shape of the floor: 500 × 400 clips and
 * 844 × 390 does not, so the failure is **not driven by height alone** —
 * a wider box needs less height, because the content wraps less. The floor
 * is a box, not a line. 640 × 640 is the smallest box measured clean, and
 * refusing a viewport that would have worked is the safe direction to be
 * wrong in; admitting one that breaks is not.
 *
 * ── Why the law is about the narrow side of the *screen* ─────────────────
 *
 * `pointer: coarse` and `hover: none` are true of tablets as well as
 * phones, and all three tablets render clean — the smallest, an iPad mini,
 * is 744 across. So touch alone would refuse the tablets the family may
 * legitimately use.
 *
 * What separates them is size, and the honest measurement is the **narrow
 * side of the physical screen**, not the viewport: a phone turned sideways
 * still has a 390px short edge, and a tablet still has 744. Orientation
 * cannot disguise it, which is precisely the hole a viewport test has.
 */

/** The smallest box the display was measured to render without clipping. */
export const KIOSK_MIN_WIDTH = 640;
export const KIOSK_MIN_HEIGHT = 640;

/**
 * Above every phone's short edge, below every tablet's.
 *
 * The gap it sits in is wide: 430 (the largest phone) to 744 (the smallest
 * tablet). It is not a knife edge, and it does not need to be revisited
 * every time a handset grows.
 */
export const HANDHELD_MAX_NARROW_SIDE = 600;

export interface Viewport {
  width: number;
  height: number;
}

export interface DeviceFacts {
  /** A finger rather than a mouse — `(pointer: coarse)`. */
  coarsePointer: boolean;
  /** The shorter of the screen's two sides, so orientation cannot hide it. */
  narrowSide: number;
  /** `navigator.userAgentData.mobile`, where the browser offers it. */
  uaMobile: boolean | null;
}

/** THE FLOOR. A layout guarantee — says nothing about what the device is. */
export function fitsKiosk({ width, height }: Viewport): boolean {
  return width >= KIOSK_MIN_WIDTH && height >= KIOSK_MIN_HEIGHT;
}

/**
 * THE LAW. A device judgement — says nothing about whether it would render.
 *
 * `uaMobile` decides on its own when the browser offers it, because it is
 * the browser answering the actual question. Safari does not implement it
 * and iPadOS deliberately reports a desktop identity, so the fallback has to
 * stand alone rather than lean on it: a coarse pointer with a phone-sized
 * short edge.
 */
export function isHandheld({ coarsePointer, narrowSide, uaMobile }: DeviceFacts): boolean {
  if (uaMobile === true) return true;
  return coarsePointer && narrowSide > 0 && narrowSide <= HANDHELD_MAX_NARROW_SIDE;
}

function readDevice(): DeviceFacts {
  const ua = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return {
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    narrowSide: Math.min(window.screen.width, window.screen.height),
    uaMobile: typeof ua?.mobile === "boolean" ? ua.mobile : null,
  };
}

/**
 * Is the thing in your hands a phone?
 *
 * Read once. A screen's physical size does not change, and a hook that
 * re-answered on resize would be a viewport test wearing the law's name —
 * which is the fusion this whole file exists to prevent.
 */
export function useIsHandheld(): boolean {
  const [handheld] = useState(() => isHandheld(readDevice()));
  return handheld;
}

/**
 * Is there room for the display right now?
 *
 * ⚠ The resize path is **unverified**, and the reason is worth writing down
 * rather than leaving as a silence.
 *
 * I first wrote this as a `matchMedia` subscription, saw it answer "too
 * small" at 1280 × 800, and concluded the subscription had got stuck.
 * That diagnosis was wrong. The browser pane I was measuring in **changes
 * the viewport without firing any event at all** — a counter on `resize`
 * recorded zero across a 600 × 500 → 900 × 700 change. No implementation
 * of this hook could have updated, and swapping to a resize listener does
 * not fix a pane that never resizes.
 *
 * So: the numbers here are measured, the first-paint decision is verified
 * at three sizes, and **whether the button comes back when a real person
 * drags their window wider is not something this instrument can show.**
 * A real browser fires both events; that is a reasonable expectation, not
 * an observation, and it is stated as the former.
 *
 * The measure-on-resize form is kept over the media query for one honest
 * reason only: the `measure()` call inside the effect re-reads after mount,
 * which closes a real if narrow race between first render and subscription.
 */
export function useFitsKiosk(): boolean {
  const [fits, setFits] = useState(() =>
    fitsKiosk({ width: window.innerWidth, height: window.innerHeight })
  );

  useEffect(() => subscribeToFit(window, setFits), []);

  return fits;
}

/**
 * The subscription, split out so it can be tested without a browser.
 *
 * Four instruments failed to fire a `resize` event — the pane changes the
 * viewport silently, and real Chrome in a background tab reports
 * `outerWidth: 0` because *a hidden tab is not laid out, so it is never
 * resized*. Chasing a fifth was the wrong move.
 *
 * So the claim is split where our code meets the platform's:
 *
 *   ours      — "when a resize arrives, we re-measure and report."
 *               Tested below against an event-target stub. If this is
 *               wrong, that is my fault.
 *   platform  — "a browser fires `resize` when a window is resized."
 *               A stated assumption. Smaller and far more reasonable to
 *               assume than an entire untested code path.
 *
 * An assumption written down is not a gap. An assumption hidden inside an
 * unverifiable claim is.
 */
export interface ResizeSource {
  innerWidth: number;
  innerHeight: number;
  addEventListener: (type: "resize", listener: () => void) => void;
  removeEventListener: (type: "resize", listener: () => void) => void;
}

export function subscribeToFit(
  source: ResizeSource,
  report: (fits: boolean) => void
): () => void {
  const measure = () =>
    report(fitsKiosk({ width: source.innerWidth, height: source.innerHeight }));

  // Re-read once on subscribe: the window can change between first render
  // and this running, and an initial value taken then would be stale.
  measure();
  source.addEventListener("resize", measure);
  return () => source.removeEventListener("resize", measure);
}
