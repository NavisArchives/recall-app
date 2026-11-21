import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * M214 — the refusal must not invent a creator.
 *
 * `MobileShelf`'s sheet explains to a non-admin why they cannot add to a
 * channel. `creatorOf` returns "no name" for two situations that are not
 * equivalent, and the sheet said the same sentence for both:
 *
 *   A. `created_by` IS NULL — nobody was ever recorded. "Somebody else made
 *      this, so only they can add to it" asserts a creator who does not
 *      exist, and points the reader at nobody. Only an admin can add.
 *   B. the contributor read failed — `canEdit` has already proved
 *      `created_by !== profile.id`, so somebody else genuinely did make it.
 *      True, merely unnamed.
 *
 * The M208 verdict covering this site said the sheet named nobody, and
 * treated that as sufficient. It is sufficient against **misidentification**
 * and silent about **asserting existence** — the claim that fails is not
 * *who* made it, it is *that anyone did*.
 *
 * ── Why this is a test and not a comment ─────────────────────────────────
 *
 * The verdict in `fabricatedFigures.test.ts` is prose, and prose is the one
 * artefact nothing executes — the same reason `ShelfPage`'s false exemption
 * stood for months. This asserts the three branches exist, so reverting to
 * two fails here rather than being noticed by somebody's eye.
 *
 * Verified on screen against a fixture built for it (scratch channel 07,
 * "Found in a drawer", `created_by: null` — the state had NO fixture
 * before, which is exactly how it survived).
 */
const SOURCE = readFileSync(
  new URL("../../mobile/MobileShelf.tsx", import.meta.url).pathname,
  "utf8"
);

describe("the sheet distinguishes 'nobody was recorded' from 'we could not check'", () => {
  it("says an administrator can add when no creator was recorded", () => {
    // Case A. Must not assert a creator, and must name the actual door —
    // saying only "nobody is recorded" leaves the reader hunting.
    expect(SOURCE).toContain("No one is recorded as having made this");
    expect(SOURCE).toContain("only an administrator can add to it");
  });

  it("says so plainly when the contributor list could not be read", () => {
    // Case B, and it must be its own sentence — indistinguishable from A
    // was the bug, not a cosmetic detail.
    expect(SOURCE).toContain("We could not check who made this");
  });

  it("still names a creator it does know", () => {
    // The positive control: the fix must not flatten the good case.
    expect(SOURCE).toContain("Created by ${who.name} — only they can add to it.");
  });

  /*
   * The three must be distinct branches, not one string with a ternary
   * inside it. `creatorOf` returning a tagged union is what makes them
   * distinguishable at all — a boolean, or a nullable name, cannot say
   * "nobody was recorded" as against "we did not ask" (M208's own lesson,
   * which this mission corrects for having applied too narrowly).
   */
  it("models the three as three, rather than a nullable name", () => {
    expect(SOURCE).toContain('kind: "none"');
    expect(SOURCE).toContain('kind: "unknown"');
    expect(SOURCE).toContain('kind: "named"');
  });
});
