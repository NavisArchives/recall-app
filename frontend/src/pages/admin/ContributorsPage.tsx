import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Lock, MoreVertical, UserPlus } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LockedNotice } from "@/components/admin/LockedNotice";
import { useDisplay } from "@/lib/DisplayContext";
import { roleLabel } from "@/lib/labels";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { StatusPill } from "@/components/admin/StatusPill";
import { PageFrame, PageHeader, CreamInset } from "@/components/admin/kit";
import {
  useActivity,
  useMissions,
  usePeopleStream,
  type ActivityRow,
} from "@/hooks/useAdminData";
import type { Author, Channel } from "@/types";

/*
 * Contributors, frame 1d.
 *
 * A card per person: who they are, what they have put in, and what they did
 * last. Every figure on a card is measured — photographs and channels from
 * the people stream (M103), missions from the board, the footer line and
 * "last active" from the activity log. Presence is the one thing nothing
 * records, so "Active now" is derived: an activity entry in the last
 * fifteen minutes is evidence somebody is here, and past that the card says
 * when they last were, which is what the family actually wants to know.
 *
 * The frame draws no back control and no header invite button, both on
 * purpose: 1d is a top-level destination — the pill nav is the way out —
 * and the cream card is the one door into the invite flow (3b's note:
 * "the header button is gone").
 */

/** "joined May 2026" — or leading its line, "Joined May 2026". */
function joinedLabel(iso: string | null, leading: boolean): string | null {
  if (!iso) return null;
  const when = new Date(iso).toLocaleDateString("en", { month: "long", year: "numeric" });
  return `${leading ? "Joined" : "joined"} ${when}`;
}

/** Day-grained relative time: today · yesterday · Tuesday · 12 Jul. */
function dayLabel(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return then.toLocaleDateString("en", { weekday: "long" });
  return then.toLocaleDateString("en", { day: "numeric", month: "short" });
}

/**
 * The footer sentence: the person's latest log line, without their own name
 * leading it — the card has already said who they are. The activity log
 * writes "Anne added 2 photographs"; on Anne's card that reads "Added
 * 2 photographs · today". A line that does not start with the name passes
 * through untouched rather than being guessed at.
 */
function footerLine(row: ActivityRow, name: string): string {
  let text = row.description;
  // The log's actorName writes the first name ("Marie added…"), so try the
  // full name first and the first name after it — checked against the live
  // log, where full-name-only left "Marie added 2 photographs" on Marie's
  // own card.
  const first = name.split(/\s+/)[0];
  if (text.startsWith(name)) text = text.slice(name.length).trim();
  else if (first && text.startsWith(`${first} `)) text = text.slice(first.length).trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return `${text} · ${dayLabel(row.created_at)}`;
}

/** One measured figure of the stats row: 27px light over an 11px label. */
function Stat({
  value,
  label,
  unknown = false,
}: {
  value: number;
  label: string;
  /** The figure was never read — a dash, never a zero (M202/M208). */
  unknown?: boolean;
}) {
  return (
    /* flex-none: the three figures are a fixed vocabulary and must not be
       squeezed into an ellipsis by a long status line beside them (the
       status yields instead — see the stats row). */
    <span className="flex-none">
      <span className="block text-[27px] font-light leading-none short:text-[23px]" style={{ color: "var(--cream)" }}>
        {unknown ? "—" : value}
      </span>
      <span
        className="mt-1.5 block text-[11px] leading-[1.25]"
        style={{ color: "var(--fg-soft)" }}
      >
        {label}
      </span>
    </span>
  );
}

/** The mono role pill: ADMIN in the accent, a relationship in quiet white. */
function RolePill({ text, accent }: { text: string; accent: boolean }) {
  return (
    <span
      className="flex-none rounded-full px-2 py-1 font-mono text-[9px] font-medium tracking-[0.08em]"
      style={
        accent
          ? { background: "rgba(var(--accent-channels),.16)", color: "var(--accent-soft)" }
          : { background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }
      }
    >
      {text}
    </span>
  );
}

/**
 * The cream invite card — the fourth grid cell, and the one door into the
 * invite flow. The palette inverts here for the same reason it does on the
 * mission list: this is the thing being offered, not another surface among
 * surfaces. The copy answers the objection a family member actually raises.
 */
function InviteCard() {
  return (
    <CreamInset className="flex h-full flex-col rounded-[22px] p-6">
      <div className="flex items-center gap-2.5">
        <UserPlus size={16} strokeWidth={1.8} aria-hidden />
        <span className="text-[15px] font-medium">Invite a contributor</span>
      </div>

      <p className="mt-3 text-[13px] leading-[1.5]" style={{ color: "rgba(var(--on-panel-alt-channels),.7)" }}>
        No passwords, no app store — they join with a six-letter code and add photos from
        their phone.
      </p>

      <Link
        to="/admin/contributors/invite"
        className="mt-auto inline-flex w-fit items-center rounded-full px-5 py-[11px] text-[13px] font-medium"
        style={{ background: "var(--on-cream)", color: "var(--cream)" }}
      >
        Create invite
      </Link>

      {/* Demoted, not deleted — the only route to a no-email member until
          M102 moves that branch inside the invite flow. */}
      <Link
        to="/admin/create-author"
        className="mt-3 text-[12px] underline"
        style={{ color: "rgba(var(--on-panel-alt-channels),.6)" }}
      >
        Somebody without an email?
      </Link>
    </CreamInset>
  );
}

export function ContributorsPage() {
  const navigate = useNavigate();
  const { isAdmin, profile } = useAuth();
  const { setStatus, subjectName } = useDisplay();
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    setStatus({ hint: "CONTRIBUTORS" });
    return () => setStatus(null);
  }, [setStatus]);

  /*
    `isPending`, not `isLoading` — M191's hole, still open here (M202).

    Found by looking at the paused state in /dev/pages: this page said
    "No contributors yet." while the request was parked mid-retry. React
    Query defines `isLoading` as `isPending && isFetching`, so a query that
    is pending but not *currently* fetching reports `isLoading: false`,
    `isError: false` and no data all at once — and the empty branch below
    is guarded on exactly those two being false.

    M191 fixed this in `listState`; this page does the same work by hand
    and so never got the fix. That is the argument for the shared decision,
    and the argument for looking at the failed states rather than trusting
    that a class was closed.
  */
  const { data: people, isPending: isLoading, isError, error } = useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Author[]>("/people"),
  });
  const {
    data: channels,
    isPending: channelsPending,
    isError: channelsFailed,
  } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<Channel[]>("/channels"),
  });
  /*
    The per-person figures on every card come from this one read (M208).
    Unguarded, `facts` is undefined for everybody and each card renders
    "0 photographs · 0 channels made" — a statement about what each person
    has given the archive, made from a request that never answered, on the
    page whose whole job is to credit them.
  */
  const {
    data: stream,
    isPending: streamPending,
    isError: streamFailed,
  } = usePeopleStream();
  const streamUnread = streamPending || streamFailed;
  /*
    Found by the M213 sweep, and it is the pattern that sweep exists for:
    on a card whose stream figures honestly read "—", the mission figure
    beside them said "0 missions done". One query's failure narrated by
    another query's success, on the same card, in the same line.
  */
  const {
    data: missions,
    isPending: missionsPending,
    isError: missionsFailed,
  } = useMissions();
  const missionsUnread = missionsPending || missionsFailed;
  const { data: activity } = useActivity();

  const contributors = (people ?? []).filter((p) => p.role !== "user");
  const subject = subjectName?.trim() || null;

  const photographs = (channels ?? []).reduce(
    (n, c) => n + (c.photo_count ?? c.media_count ?? 0),
    0
  );

  /* One pass over each source, then O(1) per card. */
  const streamBy = useMemo(
    () => new Map((stream?.circle ?? []).map((c) => [c.id, c])),
    [stream]
  );
  const missionsBy = useMemo(() => {
    const m = new Map<string, { open: number; done: number }>();
    for (const row of missions ?? []) {
      if (!row.assigned_to) continue;
      const entry = m.get(row.assigned_to) ?? { open: 0, done: 0 };
      if (row.status === "completed") entry.done += 1;
      else entry.open += 1;
      m.set(row.assigned_to, entry);
    }
    return m;
  }, [missions]);
  const lastActBy = useMemo(() => {
    const m = new Map<string, ActivityRow>();
    for (const row of activity ?? []) {
      const id = row.author?.id;
      if (id && !m.has(id)) m.set(id, row); // rows arrive newest first
    }
    return m;
  }, [activity]);

  /*
    MOST ACTIVE is a comparison, so it needs the whole circle: the person
    with the most photographs added, provided anyone has added any. One
    holder of the pill, ties to whoever the stream lists first.
  */
  const mostActiveId = useMemo(() => {
    let best: { id: string; n: number } | null = null;
    for (const c of stream?.circle ?? []) {
      if (c.media_added > 0 && (!best || c.media_added > best.n))
        best = { id: c.id, n: c.media_added };
    }
    return best?.id ?? null;
  }, [stream]);

  return (
    /* A roster: a filter over three contributors would be fake
       functionality, so there is no control row and the cards start on the
       higher line every roster shares. The one add-affordance stays the
       cream invite card in the grid. */
    <PageFrame
      type="roster"
      header={
        <PageHeader
          title="Contributors"
          subtitle={
            <>
              The people who feed {subject ? `${subject}'s` : "this"} archive
              {/*
                The figure is a claim too (M202).

                "· 0 photographs between them" is a statement about what
                this family has gathered, and it came from
                `(channels ?? []).reduce(...)` — so a shelf that failed to
                load produced a confident zero about people's contributions,
                on the page that is about crediting them. It showed in the
                paused state as well, before anything had arrived.

                The channels query is a different request from the people
                one, so it needs its own answer: the count waits for the
                shelf, and the sentence stands without it.
              */}
              {!channelsPending && !channelsFailed && (
                <>
                  {" · "}
                  {photographs} {photographs === 1 ? "photograph" : "photographs"} between them
                </>
              )}
            </>
          }
          actions={
            !isAdmin ? (
              <LockedNotice what="Everyone helping with this archive. Adding or changing a person is an administrator's to do." />
            ) : undefined
          }
        />
      }
    >
      {isLoading && (
        <p className="mt-8" style={{ color: "var(--fg-soft)" }}>
          Loading…
        </p>
      )}

      {/* The failure said out loud — it used to fall through to "No
          contributors yet.", inviting an admin to re-create people who
          exist. The message is api.ts's or the backend's own sentence. */}
      {isError && (
        <div className="flex flex-1 items-center justify-center">
          <p style={{ color: "var(--fg-soft)" }}>
            {error instanceof Error ? error.message : "The contributors could not be loaded."}
          </p>
        </div>
      )}

      {/* Empty no longer hides the door: the one moment the invite card
          matters most is when there is nobody yet. */}
      {!isLoading && !isError && contributors.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <p style={{ color: "var(--fg-soft)" }}>No contributors yet.</p>
          {isAdmin && (
            <div className="w-full max-w-[448px]">
              <InviteCard />
            </div>
          )}
        </div>
      )}

      {/*
        The scroller is `overflow-y-auto` at every width, not `md:`. Below
        768 this region clipped instead of scrolling — 974px of cards in a
        453px box, the third card sliced mid-height, Sophie and the invite
        card unreachable in the dark below. The no-scroll rule is the kiosk
        display's, not this page's (wireframes-mobile: "scrolls vertically,
        nothing clipped, nothing off-screen").
      */}
      {!isError && contributors.length > 0 && (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
          <div
            className="grid content-start grid-cols-1 gap-3 md:grid-cols-2 md:gap-3.5 md:[grid-auto-rows:236px] short:md:[grid-auto-rows:176px] xl:grid-cols-3"
          >
            {contributors.map((person) => {
              const own = person.id === profile?.id;
              const locked = !isAdmin && !own;
              const facts = streamBy.get(person.id);
              const m = missionsBy.get(person.id) ?? { open: 0, done: 0 };
              const lastAct = lastActBy.get(person.id);
              const activeNow =
                !!lastAct && Date.now() - new Date(lastAct.created_at).getTime() < 15 * 60_000;

              /* The pill names the role when it is ADMIN, the relationship
                 otherwise; the meta line carries whichever the pill did not. */
              const pill = person.role === "admin"
                ? "ADMIN"
                : (person.relationship || roleLabel(person.role) || "").toUpperCase();
              const meta = [
                person.role === "admin" ? person.relationship : null,
                joinedLabel(person.joined_at ?? null, person.role !== "admin" || !person.relationship),
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <div
                  key={person.id}
                  role="button"
                  tabIndex={0}
                  /*
                   * Where a card goes depends on who is pressing it (M51/M52).
                   * Your own card is My Info, the one page you may change;
                   * everyone else's opens their profile if you administer the
                   * archive, and otherwise does nothing — the lock has said
                   * why, and greying the card would say "broken" instead.
                   */
                  onClick={() => {
                    if (own) navigate("/admin/my-info");
                    else if (isAdmin) navigate(`/admin/contributors/${person.id}`);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    if (own) navigate("/admin/my-info");
                    else if (isAdmin) navigate(`/admin/contributors/${person.id}`);
                  }}
                  className="pressable relative flex cursor-pointer flex-col gap-4 rounded-[22px] p-[20px_20px] text-left short:gap-3 short:p-[15px_17px]"
                  style={{
                    background: "rgba(var(--ink),.045)",
                    border: "1px solid rgba(var(--ink),.09)",
                  }}
                >
                  {/* ── Identity ────────────────────────────────────── */}
                  <div className="flex flex-none items-center gap-[11px]">
                    {person.profile_picture_url ? (
                      <img
                        src={person.profile_picture_url}
                        alt=""
                        className="h-10 w-10 flex-none rounded-full object-cover"
                        style={
                          person.role === "admin"
                            ? { boxShadow: "0 0 0 4px var(--accent-tint)" }
                            : undefined
                        }
                      />
                    ) : (
                      <InitialsAvatar name={person.name} size={40} ring={person.role === "admin"} />
                    )}

                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-[16px] font-semibold leading-[1.2]"
                        style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
                      >
                        {person.name}
                      </span>
                      <span
                        className="mt-0.5 block truncate text-[11px] leading-[1.3]"
                        style={{ color: "var(--fg-soft)" }}
                      >
                        {meta}
                      </span>
                    </span>

                    <RolePill text={pill} accent={person.role === "admin"} />
                    {person.status && person.status !== "active" && (
                      <StatusPill status={person.status} />
                    )}

                    {locked ? (
                      <span
                        title="Only an administrator can open this profile"
                        className="flex h-6 w-6 flex-none items-center justify-center rounded-full"
                        style={{ background: "rgba(0,0,0,.5)", color: "rgba(var(--ink),.7)" }}
                      >
                        <Lock className="h-3 w-3" aria-hidden />
                        <span className="sr-only">You cannot open this profile</span>
                      </span>
                    ) : (
                      /* The kebab the frame draws, wired to the two real
                         verbs this app has for a person. Dead controls are
                         the fault this codebase keeps paying for (F26,
                         F36); a glyph with no menu would be another. */
                      <span className="relative flex-none">
                        <button
                          type="button"
                          aria-label={`Actions for ${person.name}`}
                          aria-expanded={menuFor === person.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuFor(menuFor === person.id ? null : person.id);
                          }}
                          /* 24px is a mouse target; a thumb needs 44 (18l's rule,
                             applied roster-wide). The glyph stays small — the
                             padding is the target. */
                          className="pressable flex size-11 items-center justify-center rounded-full sm:size-6"
                          style={{ color: "var(--fg-hint)" }}
                        >
                          <MoreVertical size={15} aria-hidden />
                        </button>
                        {menuFor === person.id && (
                          <>
                            <button
                              type="button"
                              aria-label="Close menu"
                              className="fixed inset-0 z-10 cursor-default"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuFor(null);
                              }}
                            />
                            <span
                              className="absolute right-0 top-8 z-20 flex w-[168px] flex-col overflow-hidden rounded-[14px] py-1"
                              style={{
                                background: "var(--panel-tray)",
                                border: "1px solid rgba(var(--ink),.13)",
                              }}
                            >
                              <Link
                                to={own ? "/admin/my-info" : `/admin/contributors/${person.id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="px-4 py-2.5 text-[13px] hover:bg-[rgba(var(--ink),0.05)]"
                                style={{ color: "var(--cream)" }}
                              >
                                {own ? "My info" : "View profile"}
                              </Link>
                              {isAdmin && !own && (
                                <Link
                                  to={`/admin/contributors/${person.id}/edit`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="px-4 py-2.5 text-[13px] hover:bg-[rgba(var(--ink),0.05)]"
                                  style={{ color: "var(--cream)" }}
                                >
                                  Edit details
                                </Link>
                              )}
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* ── What they have put in ───────────────────────── */}
                  {/*
                    `flex-wrap` below md: three stats and a status marker do
                    not share one phone-width line, and clipping chose for us
                    — "Last active Saturday" rendered as "L." and the MOST
                    ACTIVE pill as a sliced disc. Wrapped, the marker takes
                    its own line and the card grows (phone rows are auto).
                  */}
                  <div className="flex min-h-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2 px-1.5 md:flex-nowrap md:gap-5 xl:gap-6">
                    <Stat
                      value={facts?.media_added ?? 0}
                      label={(facts?.media_added ?? 0) === 1 ? "photograph" : "photographs"}
                      unknown={streamUnread}
                    />
                    <Stat
                      value={facts?.channels_created ?? 0}
                      label={(facts?.channels_created ?? 0) === 1 ? "channel made" : "channels made"}
                      unknown={streamUnread}
                    />
                    {missionsUnread ? (
                      <Stat value={0} label="missions" unknown />
                    ) : m.open > 0 ? (
                      <Stat value={m.open} label={m.open === 1 ? "mission open" : "missions open"} />
                    ) : (
                      <Stat value={m.done} label={m.done === 1 ? "mission done" : "missions done"} />
                    )}

                    <span className="ml-auto min-w-0 truncate text-right">
                      {person.id === mostActiveId ? (
                        <RolePill text="MOST ACTIVE" accent />
                      ) : activeNow ? (
                        <span
                          className="flex items-center gap-2 text-[12px]"
                          style={{ color: "rgba(var(--ink-cream),.75)" }}
                        >
                          <span
                            aria-hidden
                            className="h-[6px] w-[6px] rounded-full"
                            style={{
                              background: "var(--accent-soft)",
                              boxShadow: "0 0 8px rgba(226,154,104,.8)",
                            }}
                          />
                          Active now
                        </span>
                      ) : lastAct ? (
                        <span className="text-[12px]" style={{ color: "var(--fg-soft)" }}>
                          Last active {dayLabel(lastAct.created_at)}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {/* ── What they did last ──────────────────────────── */}
                  <div
                    className="mt-auto flex flex-none items-center justify-between gap-2.5 pt-[11px]"
                    style={{ borderTop: "1px dashed rgba(var(--ink),.14)" }}
                  >
                    <span
                      className="min-w-0 truncate text-[11px] leading-[1.4]"
                      style={{ color: "var(--fg-soft)" }}
                    >
                      {lastAct ? footerLine(lastAct, person.name) : "Nothing in the log yet."}
                    </span>
                    <Link
                      to="/admin/activity"
                      onClick={(e) => e.stopPropagation()}
                      className="-my-3 flex-none py-3 text-[11px] font-medium sm:my-0 sm:py-0"
                      style={{ color: "rgba(var(--ink-cream),.85)" }}
                    >
                      View activity →
                    </Link>
                  </div>
                </div>
              );
            })}

            {/* The one cream card — the single door into the invite flow
                (3b: "the header button is gone"), with the no-email line
                demoted beneath it until M102 moves that branch inside. */}
            {isAdmin && <InviteCard />}
          </div>
        </div>
      )}
    </PageFrame>
  );
}
