import { findCollapses } from "./collapseGuard";

/**
 * The collapse guard, wired to the running app in development (M190).
 *
 * It watches the page after layout and again whenever the window is resized,
 * and prints any element that rendered at a fraction of the width it asked
 * for — together with the ancestor chain, because the cause is always an
 * ancestor and never the element itself.
 *
 * What this is honest about: it cannot fail a build, and it only speaks when
 * someone opens the page. It does not replace looking. What it changes is
 * the cost of looking *badly*: six 3px hairlines are easy to scroll past on a
 * phone, and impossible to miss when the console names them and points at the
 * container that starved them. The doctrine stands unchanged — if a screen
 * cannot be looked at, that is a blocker to disclose, not a standard to lower.
 *
 * Dev only. Never bundled into what a family runs: the import in `main.tsx`
 * is behind `import.meta.env.DEV`, so this file is dropped at build time.
 */

let scheduled = 0;

function scan(reason: string) {
  const found = findCollapses(document.body, window);
  if (found.length === 0) return;

  console.groupCollapsed(
    `%c⚠ ${found.length} collapsed element${found.length === 1 ? "" : "s"} at ${window.innerWidth}px (${reason})`,
    "color:#e0a35c;font-weight:600"
  );
  console.log(
    "An element rendered at a fraction of the width it asked for. This is the class that\n" +
      "shipped six 3px PIN cells to the live sign-in screen: it fits the viewport, nothing\n" +
      "overflows, and no width check can see it. The cause is in the chain below — look for\n" +
      "the first ancestor that shrink-wraps instead of holding a width."
  );
  for (const c of found) {
    console.log(
      `${c.description} → ${c.rendered}px${c.maxWidth ? ` (asked for up to ${c.maxWidth}px)` : ""}`,
      "\n  chain:",
      c.chain.map((a) => `${a.description}=${a.width}px`).join("  ←  ")
    );
  }
  console.groupEnd();
}

/** Coalesced, because resize fires continuously and layout is the expensive part. */
function schedule(reason: string) {
  window.clearTimeout(scheduled);
  scheduled = window.setTimeout(() => scan(reason), 250);
}

export function watchForCollapses() {
  if (document.readyState === "complete") schedule("load");
  else window.addEventListener("load", () => schedule("load"), { once: true });

  window.addEventListener("resize", () => schedule("resize"));

  /*
    Route changes and data arriving both re-lay-out the page without a resize,
    and both are exactly when a row first gets real content. A mutation
    observer is broad on purpose: the scan is cheap, the scheduler coalesces,
    and a guard that only checked the first paint would have missed the PIN
    screen entirely — it renders after a profile is chosen.
  */
  new MutationObserver(() => schedule("update")).observe(document.body, {
    childList: true,
    subtree: true,
  });
}
