import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * M209 — what the backstops are allowed to stop walking, and why.
 *
 * Both backstops walk `src/` and key every file. Neither knows what ships.
 * `Sidebar.tsx` was orphaned on 7 Aug (`cf43593` removed its only import)
 * and then received **three** corrections in thirteen days — the backstop's
 * own first-run finding, M191's, and mine — before a hand-grep noticed it
 * renders to nobody. Nothing fired for the first two, and nothing would fire
 * if it happened again tomorrow.
 *
 * ── The number that looks like hygiene and is a trap ─────────────────────
 *
 * `fabricatedFigures` keys 2 dead sites out of 28. That is 7.1% only
 * *because one orphan happened to hold one shape the regex matches* — it is
 * a sample of one, not a bound. Eight more orphans could match tomorrow.
 *
 * And `absenceClaims` reads **0% contaminated as a residue, not an
 * all-clear**: `Sidebar` passes it today because a wasted fix put
 * `listState` into an already-dead file. A clean number bought by no-op work
 * is indistinguishable from a clean number bought by work that reached
 * somebody. That is the whole mission.
 *
 * ── The direction this must fail in ──────────────────────────────────────
 *
 * The dangerous mistake is the reverse of the one that prompted this: a
 * **live** file wrongly excluded leaves the population silently and the
 * suite goes green over a real defect. So:
 *
 *   unknown ⇒ reachable ⇒ still keyed.
 *
 * If the census file is missing, unreadable or empty, `shippedModules()`
 * returns null and every caller keys everything, exactly as before this
 * existed. Being unable to prove a file is dead is not evidence that it is.
 */

const CENSUS = new URL("./shipped-modules.json", import.meta.url).pathname;

/**
 * The modules the bundler actually emitted, or null when we cannot tell.
 *
 * Null is a real answer and callers must treat it as "exclude nothing".
 */
export function shippedModules(): Set<string> | null {
  try {
    const parsed = JSON.parse(readFileSync(CENSUS, "utf8")) as { modules?: string[] };
    if (!Array.isArray(parsed.modules) || parsed.modules.length === 0) return null;
    return new Set(parsed.modules);
  } catch {
    return null;
  }
}

/**
 * Files knowingly excluded from the backstops because nothing imports them.
 *
 * Hand-written and greppable **on purpose** — this is the M204 lesson about
 * `KNOWN_LISTS` applied again: a hand list is safe when its omissions are
 * loud. Every entry is checked against the census below, so a file that
 * leaves the bundle fails **by name** rather than slipping out of the
 * population, and an orphan that comes back to life fails too.
 *
 * Deleting these is deliberately NOT this mission's decision, and it is not
 * free: Tailwind's content glob scans unimported files, so their class
 * strings can still affect the emitted CSS.
 */
export const KNOWN_ORPHANS = [
  "components/admin/Sidebar.tsx",
  "components/admin/ShelfCard.tsx",
  "components/admin/MissionCard.tsx",
  // components/ui/* and lib/utils.ts were deleted with their dependencies
  // (29 Sep 2026 review, finding 25), so they are no longer excused here.
] as const;

/**
 * Files pinned as live, asserted **before** any exclusion is honoured.
 *
 * A census that saw nothing would mark the whole codebase dead, and every
 * exclusion would then be "correct" against an empty set. These are the
 * positive control: ordinary, unmistakably shipping files spread across the
 * directories the backstops walk. If the census cannot see them, it cannot
 * be trusted to say anything is absent.
 */
export const PINNED_LIVE = [
  "main.tsx",
  "App.tsx",
  "pages/admin/ContributorProfilePage.tsx",
  "components/admin/StatusPill.tsx",
  "mobile/MobileOverview.tsx",
  "lib/listState.ts",
] as const;

/**
 * Every tracked source file, from git rather than from the working tree.
 *
 * `readdirSync` walks whatever happens to be on disk, and this repository is
 * a shared checkout with several committers: another seat's untracked
 * scratch file becomes part of the population, and a file staged but not
 * present in a worktree drops out of it. Neither is a fact about the
 * product. `git ls-files` bounds the population to what is tracked; the
 * *contents* still come from disk, because uncommitted edits are exactly
 * what a backstop should be reading before they land.
 */
export function trackedSourceFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", "*.ts", "*.tsx"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });

  return out
    .split("\0")
    .filter(Boolean)
    .filter((rel) => !rel.includes("__tests__"))
    /*
      `dev/` is the states harness. It was excluded by *basename at any
      depth*, which would also have dropped a real `pages/admin/dev/…` if
      anybody made one — an exclusion wider than the thing it excuses. It is
      a single top-level directory and is now matched as one.
    */
    .filter((rel) => !rel.startsWith("dev/"))
    .map((rel) => rel);
}

/** Absolute path for a tracked file, given the root the walk started from. */
export const absolute = (root: string, rel: string) => join(root, rel);
