/**
 * "Did this element render at a fraction of the size it asked for?" (M190)
 *
 * The bug this exists for shipped to the live sign-in screen: six PIN cells,
 * each declaring `max-w-[54px]`, each rendering **3px wide**. Every numeric
 * check passed — the page fitted the viewport, nothing overflowed, no text
 * was squeezed — because 3px boxes fit beautifully and hold no text. The
 * only instrument that saw it was a person looking at a screenshot.
 *
 * Static analysis cannot catch it either, and that was measured rather than
 * assumed: the pattern is a fluid child (`flex-1`, i.e. `flex-basis: 0`)
 * inside an ancestor chain with no definite width, and the chain routinely
 * crosses components — a card in one file, a row in another. Keying a
 * source-level rule on the fluid child flags 35 of 41 files, which is a
 * hand-maintained list wearing a backstop's clothes.
 *
 * So the check runs where the answer exists: after layout, in a browser, in
 * development. It cannot fail a build, and it is honest about that — its job
 * is to make a collapse *impossible to miss* by whoever next opens the page,
 * at whatever width their window happens to be, instead of relying on them
 * noticing six hairlines. Sight is still required; this makes sight louder.
 *
 * The decision below is a pure function so the existing test runner can
 * cover it without a layout engine — the same split as `listState`.
 */

export interface Measured {
  /** The width the element actually rendered at, in CSS pixels. */
  rendered: number;
  /** Its computed `max-width` in px, or null when it declares none. */
  maxWidth: number | null;
  /** Computed `flex-grow`. A fluid child is the shape that collapses. */
  flexGrow: number;
  /** The width of its offset parent, so a hidden subtree is not a finding. */
  parentWidth: number;
  /**
   * The height it rendered at — the only thing that separates *collapsed*
   * from *absent* when the width is zero (M198). A `display:none` element
   * measures zero in both directions; one that is laid out and merely
   * starved of width still has its height.
   */
  renderedHeight: number;
}

/**
 * How small is "collapsed": under a tenth of what the element asked for, and
 * small enough that nothing could be read or tapped in it. Both, not either
 * — a 40px cell that wanted 54 is a squeeze and a design question; a 3px one
 * that wanted 54 is a bug.
 */
const COLLAPSE_RATIO = 0.1;
const UNUSABLE_PX = 12;

export function isCollapsed(m: Measured): boolean {
  // A subtree that is not laid out at all (hidden, unmounted, display:none)
  // measures zero everywhere. That is absence, not collapse, and reporting it
  // would bury the real findings in noise.
  if (m.parentWidth <= 0) return false;

  /*
    Zero is a collapse, not an absence — when the parent has width (M198).

    This used to skip `rendered <= 0` outright, which meant **the completest
    collapse was the one the guard ignored**: an element 56px tall rendering
    0px wide, inside a parent that is plainly laid out, said nothing at all.
    Reachable today — `PinInput`'s caret is absent when the field is disabled
    or has succeeded, and the cells around it are exactly the shape that
    starves.

    The `parentWidth <= 0` check above still excludes what zero usually means
    — a hidden or unmounted subtree, where everything measures zero and
    reporting it would bury every real finding. What is left is an element
    that rendered to nothing while its parent had room to give.
  */
  if (m.rendered <= 0) {
    // Zero by zero is a subtree that is not laid out at all — hidden,
    // unmounted, `display:none`. Reporting those would bury every real
    // finding, and my first attempt at this fix did exactly that until the
    // existing assertion caught it.
    if (m.renderedHeight <= 0) return false;
    return m.maxWidth !== null ? m.maxWidth > 0 : m.flexGrow > 0;
  }

  /*
    A declared ceiling is the clearest statement of intent available: the
    element said how wide it wants to be at most, and rendered nowhere near.

    The ratio answers alone here, with no pixel floor in front of it (M194).
    The floor used to run first, for every element — which meant the ratio
    only ever got to speak about things already under 12px, and the guard was
    silent on **a 600px panel rendering at 30px** or a 200px control at 14px,
    each more than 90% short. The M189 cells were caught partly because they
    happened to be small; the same circular width chain at panel or sidebar
    scale walked straight past. Proportion is the defect, not size.
  */
  if (m.maxWidth !== null && m.maxWidth > 0) {
    return m.rendered < m.maxWidth * COLLAPSE_RATIO;
  }

  /*
    Without a ceiling there is no proportion to reason about — only `flex-grow`
    saying the element wanted a share of the row. So here, and only here, the
    floor is the whole test: a fluid child at a couple of pixels means the row
    had no share to give. This is where `UNUSABLE_PX` belongs.
  */
  return m.flexGrow > 0 && m.rendered < UNUSABLE_PX;
}

/** What the console needs in order to be actionable rather than alarming. */
export interface Collapse {
  description: string;
  rendered: number;
  maxWidth: number | null;
  /** Ancestor widths, nearest first — this is the diagnosis, not decoration. */
  chain: { description: string; width: number }[];
}

function describe(el: Element): string {
  const cls = (el.getAttribute("class") ?? "").trim();
  return `${el.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).slice(0, 3).join(".")}` : ""}`;
}

/**
 * Every collapsed element in a tree, each with the ancestor chain that caused
 * it — because the cause is never the element itself. When the PIN row broke,
 * the answer was four levels up: a column that shrink-wrapped to its content
 * while its content asked it for width. Printing that chain is the difference
 * between a warning and a fix.
 */
export function findCollapses(root: ParentNode, view: Window): Collapse[] {
  const out: Collapse[] = [];

  for (const el of Array.from(root.querySelectorAll("*"))) {
    const style = view.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (!parent) continue;

    const maxWidthPx = style.maxWidth.endsWith("px") ? parseFloat(style.maxWidth) : null;

    const collapsed = isCollapsed({
      rendered: rect.width,
      renderedHeight: rect.height,
      maxWidth: maxWidthPx,
      flexGrow: parseFloat(style.flexGrow || "0"),
      parentWidth: parent.getBoundingClientRect().width,
    });
    if (!collapsed) continue;

    const chain: { description: string; width: number }[] = [];
    let up: Element | null = parent;
    for (let i = 0; i < 6 && up; i++) {
      chain.push({ description: describe(up), width: Math.round(up.getBoundingClientRect().width) });
      up = up.parentElement;
    }

    out.push({
      description: describe(el),
      rendered: Math.round(rect.width * 10) / 10,
      maxWidth: maxWidthPx,
      chain,
    });
  }

  return out;
}
