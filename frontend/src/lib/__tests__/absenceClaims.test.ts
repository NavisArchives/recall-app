import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KNOWN_ORPHANS, PINNED_LIVE, absolute, shippedModules, trackedSourceFiles } from "./shipped";

/**
 * M182 — the class, not the five instances (F70).
 *
 * M180 and M181 fixed seven places where a screen answered for a load that
 * never arrived: "Nothing has been deleted recently.", "No NFC cards
 * registered yet.", "No profile yet." Each was the same mistake, written
 * out by hand, because `data ?? []` is what the surrounding code looks
 * like and an empty array is indistinguishable from a failure.
 *
 * Fixing seven files does not stop the eighth. `listState` only protects a
 * page that opts in, and nothing points a new page at it — so this test
 * points. It is deliberately **fail-by-default**: a file that tells the
 * family something is absent, while reading data it never checked the
 * fate of, fails here until it either handles the failure or is written
 * into ALLOWED below with a reason.
 *
 * This is the shape F68/M176 settled on for the backend, one layer up: a
 * backstop plus a greppable allowlist, rather than a hand-maintained list
 * of known cases that shares the blind spot of the thing it is listing.
 *
 * It found two on its first run — `Sidebar` and `ActivityPage` — which the
 * F70 sweep had missed. That is the argument for it.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/** Reading server data. Includes the hooks that wrap `useQuery` for us. */
const READS_DATA =
  /useQuery\(|use(Channels|Missions|People|NfcCards|Activity|Suggestions|Insights|ScreenState|Ask|[A-Za-z]*Stream)\(/;

/**
 * Telling the family that something is not there. Deliberately narrow: the
 * harm is an *assertion of absence*, not any use of the word "no".
 */
const CLAIMS_ABSENCE = />\s*(No|Nothing|None)\s[^<{]{3,80}/;

/** Either the shared decision, or the page doing the same work by hand. */
const HANDLES_FAILURE = /listState|isError/;

/**
 * Files allowed to claim absence without consulting the failure — each with
 * the reason it is safe. Adding a line here is a decision someone can find;
 * that is the point of it being a list of names rather than a rule.
 *
 * Empty today. It exists so the first genuine exception is written down
 * instead of the rule being loosened.
 */
const ALLOWED: Record<string, string> = {
  /*
    `ShelfPage` used to be listed here, with the reason:

      "'No channel matches that.' is about the typed filter, not the archive
       — `rows` is a useMemo over channels that already arrived. A failed
       load never reaches it."

    **That was false**, and it sat here unchallenged while the page told
    families their filter matched nothing on a shelf that had never loaded.
    `isLoading` is false on a failed load, so the branch was reached.

    An allowlist entry is a claim like any other and nothing checks it — so
    it is the one place in this file where being wrong is silent. Two rules
    follow, and they are why the remaining entries are worded the way they
    are: **an exemption must be narrow enough to name the exact expression
    that makes it safe**, and **it must be re-read against the code, not
    against the sentence it excuses.** The page now consults the failure and
    needs no entry at all.
  */
  "pages/AdminUpload.tsx":
    "'Nothing yet — a channel can also start empty.' counts the files the " +
    "person has picked in this browser. Local state, no request behind it. " +
    "Its channel-number chain, which DID read a failed load as an empty " +
    "shelf, was M196/M199's finding and is fixed — a reminder that this " +
    "entry excuses one sentence, not the file.",
  "pages/admin/AskPage.tsx":
    "'Nothing in the titles, descriptions or captions says this yet' renders " +
    "inside `{answer && …}` — it is the archive's answer to a search that " +
    "succeeded and found nothing, and is unreachable when the search failed.",
};

/*
  What ships, and nothing else (M209).

  This backstop reads **0% contaminated**, and that number is a residue
  rather than an all-clear: `Sidebar.tsx` passes it today only because a
  wasted fix put `listState` into an already-orphaned file. It found that
  file on its very first run, a builder guarded it correctly, and it has
  read clean ever since — while reaching nobody. A clean number bought by
  no-op work is indistinguishable from one bought by work that landed.

  `unknown ⇒ reachable ⇒ still walked`: a census that cannot be read
  excludes nothing.
*/
const shipped = shippedModules();

function isDeadCode(rel: string): boolean {
  if (!shipped) return false;
  return (KNOWN_ORPHANS as readonly string[]).includes(rel) && !shipped.has(rel);
}

/**
 * M209's control, on this backstop too — asserted before any exclusion.
 */
describe("what ships, established before anything is excluded", () => {
  it("can see the files we know are live, and none of the orphans", () => {
    const shippedNow = shippedModules();
    expect(shippedNow).not.toBeNull();
    expect(PINNED_LIVE.filter((f) => !shippedNow!.has(f))).toEqual([]);
    expect(KNOWN_ORPHANS.filter((f) => shippedNow!.has(f))).toEqual([]);
  });

  it("still walks a population, rather than quietly emptying it", () => {
    // A backstop that keys nothing passes every assertion it has.
    const walked = trackedSourceFiles(ROOT).filter(
      (rel) => rel.endsWith(".tsx") && !isDeadCode(rel)
    );
    expect(walked.length).toBeGreaterThan(40);
  });
});

describe("no screen claims something is absent when it merely failed to load", () => {
  it("finds every file that reads data and asserts absence without checking failure", () => {
    const offenders: string[] = [];

    /*
      Every directory that renders, not two of them (M197).

      This walked `pages` and `components` only, so **`src/mobile/` was never
      seen** — and that is where all 19 admin routes live when the family is
      on a phone, which is most of the time. M196's chain, the one that could
      lose a family's photographs, sits squarely in that blind spot. A
      backstop with an unwalked directory is not a backstop for that
      directory; it is silence that looks like a pass.
    */
    for (const rel of trackedSourceFiles(ROOT)) {
      if (isDeadCode(rel)) continue;
      if (!rel.endsWith(".tsx")) continue;

      const src = readFileSync(absolute(ROOT, rel), "utf8");
      if (!READS_DATA.test(src)) continue;
      if (!CLAIMS_ABSENCE.test(src)) continue;
      if (HANDLES_FAILURE.test(src)) continue;

      if (rel in ALLOWED) continue;
      offenders.push(rel);
    }

    /*
      If this fails, the named file tells the family that something does not
      exist without knowing whether it asked successfully. Give it
      `listState` (or handle `isError` directly, as ContributorsPage does) —
      or, if the claim is genuinely safe, add it to ALLOWED with the reason.
      Do not widen the patterns to make this pass.
    */
    expect(offenders).toEqual([]);
  });

  /*
   * The backstop's own backstop. A rule that silently stops matching is
   * worse than no rule, and these patterns are the kind that rot quietly —
   * a refactor renames a hook, the regex matches nothing, and the suite
   * stays green while the guard is dead. So: prove it still bites.
   */
  it("still catches a page written the old way", () => {
    const offending = `
      import { useActivity } from "@/hooks/useAdminData";
      export function NewPage() {
        const { data } = useActivity(10);
        const rows = data ?? [];
        return <div>{rows.length === 0 && <p>Nothing here yet.</p>}</div>;
      }
    `;
    expect(READS_DATA.test(offending)).toBe(true);
    expect(CLAIMS_ABSENCE.test(offending)).toBe(true);
    expect(HANDLES_FAILURE.test(offending)).toBe(false);
  });

  it("lets a page through once it consults the failure", () => {
    const fixed = `
      import { listState } from "@/lib/listState";
      const state = listState({ isLoading, isError, count: rows.length });
      return <div>{state === "empty" && <p>Nothing here yet.</p>}</div>;
    `;
    expect(HANDLES_FAILURE.test(fixed)).toBe(true);
  });
});
