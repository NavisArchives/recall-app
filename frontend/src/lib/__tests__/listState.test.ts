import { describe, expect, it } from "vitest";
import { combinedListState, listState, partiallyFailed } from "../listState";

/**
 * M180 (F70) — the cold-cache failure, which is the only state that bites.
 *
 * Feedback disclosed the trap when they filed this, and it is worth keeping
 * in front of whoever edits these pages next: **a warm refetch failure does
 * not reproduce the bug.** React Query keeps serving the data it already
 * holds, so a page whose refresh fails carries on showing yesterday's list
 * and looks fine. The false sentence needs a *first* load that fails —
 * `isLoading` finished, `isError` true, and no cached rows behind it.
 *
 * An ordinary empty-state test never constructs that. These do, and that is
 * the whole point of them: the assertion below is not "empty renders when
 * the list is empty", it is "**empty must not be reachable from a failure**".
 */
describe("a list that failed to load is not a list that is empty", () => {
  const cold = { isPending: false, isError: true, count: 0 };

  it("calls a cold-cache failure an error, never an empty archive", () => {
    // The exact shape of the bug: load finished, load failed, nothing
    // cached. `data ?? []` gave 0 here, and 0 was read as "nothing exists".
    expect(listState(cold)).toBe("error");
    expect(listState(cold)).not.toBe("empty");
  });

  it("still says empty when the load genuinely succeeded with nothing in it", () => {
    expect(listState({ isPending: false, isError: false, count: 0 })).toBe("empty");
  });

  it("says loading before it says anything about content", () => {
    // A cold load in flight is not an empty archive either.
    expect(listState({ isPending: true, isError: false, count: 0 })).toBe("loading");
    // And a retry in flight over a previous failure reports the retry.
    expect(listState({ isPending: true, isError: true, count: 0 })).toBe("loading");
  });

  it("reports ready when rows arrived", () => {
    expect(listState({ isPending: false, isError: false, count: 3 })).toBe("ready");
  });

  /*
   * The warm case, stated so nobody "fixes" it later: rows survived a failed
   * refetch, so the page keeps showing them. That is React Query doing the
   * right thing, and it is why this bug hid — the page looks correct
   * precisely when it has something to show.
   */
  it("keeps showing rows that survived a failed refetch", () => {
    expect(listState({ isPending: false, isError: true, count: 3 })).toBe("ready");
  });
});

describe("a page built from several lists", () => {
  const ok = { isPending: false, isError: false, count: 0 };

  it("refuses to say 'nothing was deleted' when only one half failed", () => {
    // Archived channels came back empty; archived files never arrived. The
    // sentence is a claim about both, so one failure withdraws it.
    const state = combinedListState([ok, { isPending: false, isError: true, count: 0 }]);
    expect(state).toBe("error");
  });

  it("says empty only when every list genuinely arrived empty", () => {
    expect(combinedListState([ok, ok])).toBe("empty");
  });

  it("says ready when either list has something in it", () => {
    expect(combinedListState([ok, { isPending: false, isError: false, count: 2 }])).toBe("ready");
  });

  it("waits for the slowest list before saying anything", () => {
    expect(combinedListState([{ isPending: true, isError: false, count: 0 }, ok])).toBe("loading");
  });

  /*
   * The half-and-half case. Showing the channels is right — they are real —
   * but the files section would render as though nothing had been deleted
   * from it, which is the same lie in a smaller frame. The page has to say
   * both things at once: here is what arrived, and some of it did not.
   */
  it("knows when it is showing one half and missing the other", () => {
    const channels = { isPending: false, isError: false, count: 2 };
    const files = { isPending: false, isError: true, count: 0 };

    expect(combinedListState([channels, files])).toBe("ready");
    expect(partiallyFailed([channels, files])).toBe(true);
  });

  it("is not partially failed when everything arrived", () => {
    expect(partiallyFailed([ok, { isPending: false, isError: false, count: 2 }])).toBe(false);
  });

  it("is not partially failed when there is nothing to show at all", () => {
    // Both failed: that is the plain error state, not a partial one.
    const dead = { isPending: false, isError: true, count: 0 };
    expect(partiallyFailed([dead, dead])).toBe(false);
    expect(combinedListState([dead, dead])).toBe("error");
  });
});

/**
 * M191 — the state I did not model, found on the live `/owner` page.
 *
 * React Query defines `isLoading` as `isPending && isFetching`. A query that
 * is pending but not *currently* fetching — paused, or waiting between
 * retries — reports **`isLoading: false`, `isError: false`, and no data, all
 * at once**. This function took `isLoading`, fell through both guards, and
 * answered "empty".
 *
 * The claim I made for it in M180 was that empty is unreachable from a
 * *failure*. That was true and beside the point: empty was reachable from a
 * **non-answer**, which reads exactly as false on screen. "Nothing has been
 * deleted recently" for a load that never completed is the same lie by a
 * different route.
 *
 * Taking `isPending` closes it, because pending stays true until the query
 * actually resolves — so `empty` is now only ever said with evidence of
 * success behind it, rather than as the state left over when no other flag
 * happened to be set.
 */
describe("a load that never answered is not an empty archive", () => {
  const neverAnswered = { isPending: true, isError: false, count: 0 };

  it("does not call a paused query empty", () => {
    expect(listState(neverAnswered)).not.toBe("empty");
    expect(listState(neverAnswered)).toBe("loading");
  });

  it("does not call a paused query empty across several lists either", () => {
    const arrivedEmpty = { isPending: false, isError: false, count: 0 };
    expect(combinedListState([arrivedEmpty, neverAnswered])).toBe("loading");
    expect(combinedListState([arrivedEmpty, neverAnswered])).not.toBe("empty");
  });

  it("still says empty when every list genuinely resolved with nothing", () => {
    // The guard must not have been bought by making empty unreachable.
    const arrivedEmpty = { isPending: false, isError: false, count: 0 };
    expect(combinedListState([arrivedEmpty, arrivedEmpty])).toBe("empty");
  });
});
