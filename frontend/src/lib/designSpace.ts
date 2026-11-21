/**
 * The display's design space — 1440×810, the mockups' own frame (spec 24).
 *
 * Every size on Margaret's screens is a measurement taken from the design
 * and divided by 14.4, because 1440 design pixels are 100vw. A 200px card is
 * `13.889vw`, and on a 16:9 television that is exactly 200px again at 1440
 * wide, 267px at 1920, 400px at 2880.
 *
 * **Vertical sizes use vw too, and that is deliberate.** Using vh for
 * heights would let the layout stretch as the panel's aspect ratio drifts
 * from 16:9 — cards would grow taller on a squarer screen while their width
 * stayed put. In vw the whole composition scales as one piece and simply
 * leaves a band of ground at the top and bottom on an odd panel, which is
 * what the design wants: the proportions are the design.
 *
 * The one number that is not a size: the display header is `--header-h: 20vh`
 * ≈ 162 design pixels, so a page positioning something at the spec's `y`
 * subtracts `HEADER_PX` first — the page area starts below the header, and
 * the spec measures from the top of the frame.
 */

/** The design frame, in its own pixels. */
export const DESIGN_W = 1440;
export const DESIGN_H = 810;

/** The display header, in design pixels (`--header-h: 20vh` of 810). */
export const HEADER_PX = Math.round(DESIGN_H * 0.2);

/** A design pixel as a CSS length. `px(56)` → `"3.889vw"`. */
export function px(n: number): string {
  return `${(n / (DESIGN_W / 100)).toFixed(3)}vw`;
}

/**
 * A spec `y`, measured from the top of the frame, as an offset inside the
 * page area below the header. `fromTop(238)` → the film's top edge.
 */
export function fromTop(y: number): string {
  return px(y - HEADER_PX);
}
