/**
 * M201 — a failure is not a non-existence.
 *
 * F70's family, one step worse. F70 said *"there is nothing here"* when it
 * did not know. These three said something sharper and more confident:
 *
 *   EditChannel             "Channel not found"
 *   ChannelPreviewPage      "That channel is not in this archive."
 *   ContributorProfilePage  "This person was not found."
 *
 * on a **503**. Each one names a specific cause, and the cause is wrong. The
 * damage is not the missing sentence — it is that somebody now believes a
 * memory was deleted, or that a person was removed from the archive, and
 * goes looking for who did it.
 *
 * Only a **404** means the thing is genuinely absent. Every other refusal
 * means we could not ask. `lib/api.ts` now carries the status on the error
 * so a page can tell them apart without reading prose that is allowed to
 * change.
 *
 * ── The conservative direction ───────────────────────────────────────────
 *
 * When the status is unknown — a network failure that never reached a
 * server, an error thrown by something other than `api` — this answers
 * `"unreachable"`. That is the safe way to be wrong: "we could not load
 * this" is merely unhelpful when the thing really was deleted, while
 * "it is not there" is a false statement about the family's archive when
 * the server merely hiccuped.
 */
export type Absence = "missing" | "unreachable";

export function absenceKind(error: unknown): Absence {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 ? "missing" : "unreachable";
}

/**
 * Did the archive genuinely answer "there is no such thing"?
 *
 * Written as a positive test for the *stronger* claim, so a page has to
 * earn the right to say "not found" rather than fall into it.
 */
export function isGenuinelyMissing(error: unknown): boolean {
  return absenceKind(error) === "missing";
}
