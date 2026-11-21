import { Link } from "react-router-dom";
import { listState } from "@/lib/listState";
import type { ActivityRow, PeopleStreamPayload } from "@/hooks/useAdminData";
import { ago } from "./AccessBlock";

/**
 * CONTRIBUTION — frame 12a, with 12i's empty state.
 *
 * Three figures, then the two dates that give them meaning, then what they
 * actually did. The page used to say "1 channel — Wedding Day" and stop,
 * which answers "what did they make" and not "are they still here", and the
 * second is what an admin is usually wondering.
 *
 * ── Every figure waits for its own load ──────────────────────────────────
 *
 * `media_added` and the two channel counts come from the people stream;
 * "last contribution" is derived from the activity log. Those are two
 * different requests and either can fail on its own, so they are gated
 * separately — a dash where a number is not known, never a zero. A "0
 * memories added" printed from a failed request is a statement about
 * somebody's contribution to their family's archive, and it is the kind of
 * wrong that makes a person look absent when they are not.
 */

function Stat({
  value,
  label,
  note,
  unknown,
}: {
  value: number;
  label: string;
  note: string;
  unknown: boolean;
}) {
  return (
    <div>
      <p
        className="text-[28px] font-light leading-none"
        style={{ color: unknown ? "var(--fg-faint)" : "var(--fg)" }}
      >
        {unknown ? "—" : value}
      </p>
      <p className="mt-1.5 text-[14px]" style={{ color: "var(--fg)" }}>
        {label}
      </p>
      <p className="mt-0.5 text-[12px] leading-[1.5]" style={{ color: "var(--fg-faint)" }}>
        {note}
      </p>
    </div>
  );
}

export function ContributionBlock({
  personId,
  stream,
  streamPending,
  streamFailed,
  activity,
  activityPending,
  activityFailed,
  lastSeenAt,
}: {
  personId: string;
  stream: PeopleStreamPayload | undefined;
  streamPending: boolean;
  streamFailed: boolean;
  activity: ActivityRow[] | undefined;
  activityPending: boolean;
  activityFailed: boolean;
  lastSeenAt: string | null | undefined;
}) {
  const streamUnknown = streamPending || streamFailed;
  const mine = stream?.circle.find((c) => c.id === personId);

  /*
    A load that succeeded without this person in it cannot speak for them
    (M222).

    The stream used to drop anyone paused, so `mine` came back undefined, and
    every count below read `?? 0` — which is how the page came to tell a
    family that someone who had been paused contributed nothing. The filter
    is gone now, but the shape of the mistake is worth refusing structurally:
    a successful read that does not mention somebody is not a report of zero
    about them, it is silence about them. Absent and zero are different
    answers, and only one of them may be printed as "Nothing added yet."
  */
  const streamSpeaksForThem = !streamUnknown && !!mine;

  /*
    Their own rows out of the shared log. `author` is already on every row
    (M120 put it there), so this needs no new request — and a row without an
    author is somebody else's, not theirs.
  */
  const theirs = (activity ?? []).filter((row) => row.author?.id === personId);
  const activityState = listState({
    isPending: activityPending,
    isError: activityFailed,
    count: theirs.length,
  });
  const lastContribution = theirs[0];

  /*
    12i. "Nothing added yet" is a claim, so it needs a successful load
    behind it — and it needs BOTH loads, because a person with no activity
    rows may still have channels to their name.
  */
  const nothingYet =
    streamSpeaksForThem &&
    activityState === "empty" &&
    (mine?.media_added ?? 0) === 0 &&
    (mine?.channels_created ?? 0) === 0 &&
    (mine?.channels_authored ?? 0) === 0;

  return (
    <section className="mt-8 border-t border-line-soft pt-6">
      <p className="label-caps">Contribution</p>

      {nothingYet ? (
        <div className="mt-3">
          <p style={{ color: "var(--fg-faint)" }}>Nothing added yet.</p>
          <p className="mt-1 text-[13px]" style={{ color: "var(--fg-faint)" }}>
            The first photograph or story they add will appear here, with the date.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-3">
            <Stat
              value={mine?.media_added ?? 0}
              label="Memories added"
              note="photographs, video and stories they uploaded"
              unknown={streamUnknown || !mine}
            />
            <Stat
              value={mine?.channels_created ?? 0}
              label="Channels created"
              note="channels they made"
              unknown={streamUnknown || !mine}
            />
            <Stat
              value={mine?.channels_authored ?? 0}
              label="Channels authored"
              note="channels whose story is theirs"
              unknown={streamUnknown || !mine}
            />
          </div>

          <div className="mt-6 grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <p className="label-caps">Last contribution</p>
              <p className="mt-1 text-[15px]" style={{ color: "var(--fg)" }}>
                {activityState === "error" ? (
                  <span style={{ color: "var(--fg-faint)" }}>Could not be loaded</span>
                ) : activityState === "loading" ? (
                  <span style={{ color: "var(--fg-faint)" }}>…</span>
                ) : lastContribution ? (
                  new Date(lastContribution.created_at).toLocaleDateString("en-GB", {
                    dateStyle: "long",
                  })
                ) : (
                  <span style={{ color: "var(--fg-faint)" }}>Nothing yet</span>
                )}
              </p>
              {lastContribution && (
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--fg-faint)" }}>
                  {ago(lastContribution.created_at) ?? "a while ago"} ·{" "}
                  {lastContribution.description}
                </p>
              )}
            </div>

            <div>
              <p className="label-caps">Last signed in</p>
              <p className="mt-1 text-[15px]" style={{ color: "var(--fg)" }}>
                {lastSeenAt ? (
                  new Date(lastSeenAt).toLocaleString("en-GB", {
                    dateStyle: "long",
                    timeStyle: "short",
                  })
                ) : (
                  /*
                    `undefined` means the column was never sent — a narrowed
                    read for a non-admin — and `null` means they genuinely
                    never signed in. Saying "Never" for the first is a claim
                    about a person's absence made from our own missing data,
                    and this block sits directly above ACCESS, which would
                    then disagree with it on the same screen.
                  */
                  <span style={{ color: "var(--fg-faint)" }}>
                    {lastSeenAt === undefined ? "Not known" : "Never"}
                  </span>
                )}
              </p>
              {lastSeenAt && (
                <p className="mt-0.5 text-[12px]" style={{ color: "var(--fg-faint)" }}>
                  {ago(lastSeenAt) ?? "a while ago"}
                </p>
              )}
            </div>
          </div>

          {activityState === "ready" && (
            <ul className="mt-6 max-w-2xl">
              {theirs.slice(0, 5).map((row) => (
                <li
                  key={row.id}
                  className="flex items-baseline justify-between gap-4 border-t border-line-soft py-2.5 first:border-t-0"
                >
                  <span className="text-[14px]" style={{ color: "var(--fg-muted)" }}>
                    {row.description}
                  </span>
                  <span
                    className="flex-none font-mono text-[11px]"
                    style={{ color: "var(--fg-faint)" }}
                  >
                    {new Date(row.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {activityState === "error" && (
            <p className="mt-4 text-[13px]" style={{ color: "var(--fg-faint)" }}>
              Their activity could not be loaded, so we cannot say what they have been doing.
            </p>
          )}

          <Link
            to="/admin/activity"
            className="mt-4 inline-block font-mono text-[11px] tracking-[0.12em]"
            style={{ color: "var(--accent-soft)" }}
          >
            See all activity →
          </Link>
        </>
      )}
    </section>
  );
}
