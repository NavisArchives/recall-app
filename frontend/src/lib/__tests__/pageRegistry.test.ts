import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * M199 — the harness must not be able to go quietly out of date.
 *
 * `PageStates` is a list of the admin pages, maintained by hand. A hand
 * list is exactly what failed in M197: the backstop walked two directories
 * and not `src/mobile/`, and its silence about the third read as a pass. A
 * gallery that covers eighteen of twenty pages has the same shape — you look
 * at it, everything is fine, and the page nobody added is the one with the
 * bug.
 *
 * So the registry is checked against the routing table it claims to mirror.
 * Add a route to `App.tsx` without adding it here and this fails by name.
 *
 * It reads both files as **text** rather than importing them. Importing
 * `PageStates` would drag React, the router and every lazy chunk into a
 * node test to answer a question about two lists of strings — and would tie
 * this check to whether the app can boot, which is a different thing from
 * whether the list is complete.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url).pathname, "utf8");

/** The admin route block, up to the redirects — those are not pages. */
function adminRouteBlock(app: string): string {
  const start = app.indexOf('path="/admin"');
  const end = app.indexOf("Paths that moved");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return app.slice(start, end);
}

/** Wrappers and the shell, not pages under test. */
const NOT_A_PAGE = new Set(["Admin", "AdminLayout", "Navigate", "Route", "Display"]);

/**
 * Pages in the gallery that are NOT /admin routes, listed by name (M221).
 *
 * `/owner` is behind the platform-owner guard, so `?fail=` cannot reach its
 * routes from a family session and its failed states were unwitnessable —
 * on the one screen whose job is to report whether the platform is alright.
 *
 * Named individually rather than loosening the rule: the registry must
 * still fail when a twentieth ADMIN route appears without an entry, which
 * is the thing it exists for.
 */
const BEYOND_ADMIN = ["OwnerDashboard"];

function routedPages(block: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  /*
    Split on `<Route` followed by *any* whitespace, not by a space.

    Splitting on the literal `"<Route "` looked right and quietly merged
    every multi-line route into the chunk before it — `contributors/:id`
    absorbed the `adminOnly` belonging to `contributors/:id/edit` and was
    reported as administrator-only, which it is not. The counts still came
    to nineteen and nineteen, and the missing/stale checks still passed:
    the parse was wrong in a way that only the written-out list below could
    see. That is what that list is for.
  */
  for (const chunk of block.split(/<Route\s/).slice(1)) {
    const adminOnly = chunk.includes("adminOnly");
    for (const [, name] of chunk.matchAll(/<([A-Z][A-Za-z]*)\s*\/>/g)) {
      if (!NOT_A_PAGE.has(name)) found.set(name, adminOnly);
    }
  }
  return found;
}

function registered(gallery: string): Map<string, boolean> {
  const found = new Map<string, boolean>();
  for (const [, name, allow] of gallery.matchAll(/name: "(\w+)", allow: (BOTH|ADMIN_ONLY)/g)) {
    found.set(name, allow === "ADMIN_ONLY");
  }
  return found;
}

describe("every admin page can be looked at in every state", () => {
  const routed = routedPages(adminRouteBlock(src("App.tsx")));
  const listed = registered(src("dev/PageStates.tsx"));

  /*
    The control. Both halves of this comparison are regexes over source, and
    a regex that stops matching returns an empty set — which would make every
    assertion below pass by finding nothing on both sides. So each side must
    first be shown to have found something of the size we expect.
  */
  /*
    Twenty-four since Devices and Users landed (the hardware page and the
    archive page behind the masthead chip). The number is a tripwire, not a
    target: it exists so the two assertions below cannot pass by finding
    nothing on both sides. When a page is genuinely added, this is the line
    that says so out loud — which is the point of writing it down.
  */
  it("found the twenty-four routes and the twenty-four registry entries", () => {
    expect(routed.size).toBe(24);
    // The 24 admin routes, plus the deliberate non-admin entries below.
    expect(listed.size).toBe(24 + BEYOND_ADMIN.length);
  });

  it("has a gallery entry for every routed admin page", () => {
    const missing = [...routed.keys()].filter((name) => !listed.has(name));
    expect(missing).toEqual([]);
  });

  it("has no gallery entry for a page that is no longer routed", () => {
    const stale = [...listed.keys()].filter(
      (name) => !routed.has(name) && !BEYOND_ADMIN.includes(name)
    );
    expect(stale).toEqual([]);
  });

  /*
    "Which of the nineteen need admin rather than co_author" was one of the
    questions this harness was asked to answer. It is answered statically,
    from `App.tsx`, and pinned here so the gallery cannot claim a page is open
    to a co-author that the router turns away — a harness that is wrong about
    the product is worse than no harness.
  */
  it("agrees with the router about which pages are admin-only", () => {
    const disagreements = [...routed.entries()]
      .filter(([name, adminOnly]) => listed.get(name) !== adminOnly)
      .map(([name, adminOnly]) => `${name}: router says ${adminOnly ? "admin only" : "both"}`);
    expect(disagreements).toEqual([]);
  });

  it("names the six the router restricts to an administrator", () => {
    // Written out so a change to the gate is visible in a diff, rather than
    // being absorbed by a rule that recomputes both sides and agrees.
    // DevicesPage joined when hardware requests landed (052): asking Recall
    // to send equipment commits the family to something arriving at the
    // door, which is the same class of decision as Settings itself.
    const adminOnly = [...routed.entries()].filter(([, only]) => only).map(([name]) => name).sort();
    expect(adminOnly).toEqual([
      "ContributorEditPage",
      "CreateAuthor",
      "DeletedChannelsPage",
      "DevicesPage",
      "InvitePage",
      "SettingsPage",
    ]);
  });
});
