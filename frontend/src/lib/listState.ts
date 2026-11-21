/**
 * "Is this list empty, or did it merely fail to arrive?" (M180, F70)
 *
 * Every admin list answers this, and the pages that answered it by looking
 * only at `data ?? []` answered it wrongly: a failed load leaves `data`
 * undefined, an empty array stands in for it, and the page states a fact
 * about the archive that it has no grounds for. On the deleted-channels
 * page that fact was **"Nothing has been deleted recently."** — printed on
 * the one route back from a deletion, to somebody who had just deleted
 * something by mistake. On the NFC page it was "No NFC cards registered
 * yet.", which invites an admin to register a card that already exists.
 *
 * The rule is one line of logic and it kept being written out by hand, so
 * it kept being written out incompletely. It lives here now, as a function
 * rather than as a convention, and it fails safe: **`empty` is only ever
 * true when the load actually succeeded.** Anything unknown resolves to
 * "error" or "loading" — states that ask the reader to try again — never to
 * a claim about what the archive contains.
 *
 * A page adopting this cannot forget the error branch, because there is no
 * way to reach `empty` without having passed `isError` in.
 */
export type ListState = "loading" | "error" | "empty" | "ready";

export function listState(q: {
  /**
   * `isPending`, **not** `isLoading` — the distinction is the whole safety
   * of this function (M191).
   *
   * React Query defines `isLoading` as `isPending && isFetching`. So a query
   * that is pending but not *currently* fetching — paused, or waiting between
   * retries — reports `isLoading: false`, `isError: false` and no data, all
   * at once. This function used to take `isLoading`, fall through both
   * guards, and answer **"empty"**: "Nothing has been deleted recently." for
   * a load that never completed. The claim I made for it — that empty is
   * unreachable from a failure — was true, and beside the point: empty was
   * reachable from a *non-answer*, which reads exactly as false on screen.
   *
   * `isPending` is true until the query actually resolves, so it covers
   * loading, paused, and between-retries alike.
   */
  isPending: boolean;
  isError: boolean;
  count: number;
}): ListState {
  /*
    Order matters, and rows come first.

    A failure only misleads when it is mistaken for emptiness. If rows are
    already in hand, a failed *refetch* changes nothing the reader needs to
    know — React Query keeps serving what it holds, and blanking a working
    page because a background refresh timed out would be a worse bug than
    the one this file exists to fix. So anything with rows is `ready`,
    however the last request went.

    Then loading, because a cold load in flight is not an empty archive
    either. Then error. `empty` is what is left: the load finished, it
    succeeded, and there was genuinely nothing there.
  */
  if (q.count > 0) return "ready";
  if (q.isPending) return "loading";
  if (q.isError) return "error";
  /*
    Everything else has been excluded, so this is the one state left: the
    request finished, it succeeded, and there was nothing in it. `empty` is
    only ever said with evidence of success behind it — never as the thing
    left over when no other flag happened to be set.
  */
  return "empty";
}

/**
 * The same question for a page built from several lists at once.
 *
 * The deleted-channels page shows archived channels and archived files
 * together, and "nothing has been deleted" is a claim about *both*. One
 * query failing is enough to make the sentence unsupportable, even when
 * the other returned cleanly — so error wins over empty across the set,
 * and `empty` needs every list to have genuinely arrived and be empty.
 */
export function combinedListState(
  parts: { isPending: boolean; isError: boolean; count: number }[]
): ListState {
  if (parts.some((p) => p.count > 0)) return "ready";
  if (parts.some((p) => p.isPending)) return "loading";
  if (parts.some((p) => p.isError)) return "error";
  return "empty";
}

/**
 * Whether part of the page arrived and part of it did not.
 *
 * `combinedListState` answers what the page as a whole should render, and
 * "ready" is the right answer when one list came back with rows. But a page
 * showing its channels while its files quietly failed is telling a smaller
 * version of the same lie — the missing half looks like an absent half. A
 * page in that state shows what it has *and* says the rest is missing.
 */
export function partiallyFailed(
  parts: { isPending: boolean; isError: boolean; count: number }[]
): boolean {
  return parts.some((p) => p.isError) && parts.some((p) => p.count > 0);
}
