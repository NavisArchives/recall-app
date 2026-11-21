import { describe, expect, it } from "vitest";
import { emptyAnswerFor, hasEmptyAnswer } from "@/dev/stateStub";

/**
 * F89/M207 — the one predicate the harness's warrant rests on.
 *
 * `/dev/pages` is trusted by construction: readings taken through it are
 * reported as fact. The banner is what makes that defensible — it says what
 * the stub actually served. So a case where the banner says **covered** and
 * the stub answered with the **wrong shape** is worse than one where it
 * answers nothing, because nothing looks like nothing and a wrong answer
 * looks like coverage.
 *
 * That is exactly what happened. The predicate matched by prefix, so
 * `/people/dev-id` — **one person object** — was served `[]` and counted as
 * `emptied`. Three pages rendered a blank screen, and a mission was nearly
 * cut against `InitialsAvatar` for a crash the harness had manufactured.
 *
 * The harness is dev-only and its own screen cannot be regression-tested by
 * the suite, so this predicate is pinned here instead. It is the seam where
 * being wrong is invisible.
 */
describe("an endpoint the stub can empty is the exact path, never a prefix of it", () => {
  it("serves the lists it knows", () => {
    for (const path of ["/channels", "/people", "/missions", "/nfc-cards", "/activity"]) {
      expect(hasEmptyAnswer(path)).toBe(true);
    }
  });

  /*
   * The bug, as its cases. Each of these returns a single object, and each
   * would have been flattened into an array by the prefix rule.
   */
  it("refuses a sub-resource, which is a different shape entirely", () => {
    expect(hasEmptyAnswer("/people/dev-id")).toBe(false);
    expect(hasEmptyAnswer("/channels/detail/dev-id")).toBe(false);
    expect(hasEmptyAnswer("/missions/some-id")).toBe(false);
    expect(hasEmptyAnswer("/nfc-cards/some-id")).toBe(false);
  });

  /*
   * The control that keeps the rule honest in the other direction: nested
   * paths that ARE lists carry their own entries, so exact matching must
   * still admit them. Without this, "refuse everything nested" would pass
   * the test above while quietly breaking Recently deleted.
   */
  it("still admits nested paths that are genuinely lists", () => {
    expect(hasEmptyAnswer("/channels/archived/list")).toBe(true);
    expect(hasEmptyAnswer("/media-files/archived/list")).toBe(true);
  });

  it("does not match an unrelated endpoint that merely starts the same way", () => {
    expect(hasEmptyAnswer("/channels-summary")).toBe(false);
    expect(hasEmptyAnswer("/peoplex")).toBe(false);
  });
});

/**
 * The same fault one level down (M221).
 *
 * Fixing the *predicate* fixed which paths get an empty answer. It did not
 * fix **what that answer is** — the stub still served `[]` to every path it
 * admitted, and `/owner/families` answers an object. So the platform owner's
 * dashboard, in `empty` mode, would have been handed an array, read
 * `data.families` off it, found `undefined`, and the banner would have
 * reported the whole thing as `emptied`: covered, and wrong.
 *
 * Nobody was hurt by it only because `/owner` was not in the gallery until
 * now. The lesson is the same one, restated: a path does not tell you a
 * shape, and the place that decides shape is the route.
 */
describe("the empty body is the one its route actually returns", () => {
  it("hands /owner/families the object it reads, not a bare array", () => {
    const body = emptyAnswerFor("/owner/families");
    expect(Array.isArray(body)).toBe(false);
    // `backend/src/routes/owner.ts:218` — `{ families: rows, database: "up" }`.
    expect(body).toEqual({ families: [], database: "up" });
  });

  /*
    The control. Without it, "not an array" could be satisfied by every
    endpoint quietly becoming an object, which would break the eight that
    genuinely are lists in the same invisible way, in the other direction.
  */
  it("still hands the genuine lists a bare array", () => {
    for (const path of [
      "/channels",
      "/people",
      "/missions",
      "/nfc-cards",
      "/activity",
      "/suggestions",
      "/channels/archived/list",
      "/media-files/archived/list",
    ]) {
      expect(emptyAnswerFor(path)).toEqual([]);
    }
  });
});
