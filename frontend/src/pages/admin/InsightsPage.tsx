import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDisplay } from "@/lib/DisplayContext";
import { useAuth } from "@/context/AuthContext";
import { useChannels, useContentStream, useInsights } from "@/hooks/useAdminData";
import { LockedNotice } from "@/components/admin/LockedNotice";
import { BentoCard, CreamInset, PageFrame, PageHeader } from "@/components/admin/kit";
import { placeholderProps } from "@/lib/placeholder";
import { listState } from "@/lib/listState";
import { useIsMobile } from "@/mobile/useIsMobile";
import { MobileInsights } from "@/mobile/MobileInsights";

const CAPS = "font-mono text-[10px] tracking-[0.16em]";
export const RANGES = ["Today", "This week", "This month"] as const;
export type Range = (typeof RANGES)[number];

/** Tab label → the key the route speaks, and the phrase the copy speaks. */
export const RANGE_KEY = { Today: "today", "This week": "week", "This month": "month" } as const;
export const RANGE_PHRASE = { Today: "today", "This week": "this week", "This month": "this month" } as const;
/** What fills the dial: an hour a day, per window. */
export const DIAL_HOURS = { Today: 1, "This week": 7, "This month": 30 } as const;

export function hoursMinutes(seconds: number) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

/**
 * Insights, frame 1g: the Overview's ring and bars at page scale.
 *
 * Two of these cards are real — the time she spends and what she returns to
 * both come from `channel_visits`, which has been recording since M09. The
 * rest of the frame draws facts nothing measures yet; those are registered
 * holders rather than invented numbers, and they are the strongest argument
 * in the app for M103's engagement and content streams.
 */
/**
 * Insights, at two widths (M183, F71).
 *
 * The bento below was rendered at every width, including 375px, where its
 * three fixed columns become three ~100px slots: text narrower than its own
 * longest word, the dial's figure overlapping its label, "Described"
 * colliding with its percentage. A fixed grid does not overflow — it
 * compresses — so every measurement of the broken page came back clean, and
 * it was the owner's eyes that found it.
 *
 * Insights was the last of the four to have no phone layout; Overview,
 * Missions and Shelf have branched this way since M75. It follows them
 * rather than inventing anything.
 */
export function InsightsPage() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileInsights /> : <InsightsDesktop />;
}

function InsightsDesktop() {
  const { setStatus } = useDisplay();
  const { subjectName } = useDisplay();
  const { isAdmin } = useAuth();
  const [range, setRange] = useState<Range>("This week");
  const { data: insights, isPending, isError } = useInsights(RANGE_KEY[range]);
  const {
    data: channels,
    isPending: channelsPending,
    isError: channelsFailed,
  } = useChannels();
  const { data: content } = useContentStream();
  const phrase = RANGE_PHRASE[range];

  useEffect(() => {
    setStatus({ hint: "INSIGHTS" });
    return () => setStatus(null);
  }, [setStatus]);

  const subject = subjectName?.trim() || "the family";
  const period = insights?.window;
  const returns = insights?.most_visited ?? [];
  // M182: an unread list and an unreadable one are different answers.
  const returnsState = listState({ isPending, isError, count: returns.length });
  /*
    F87/M205 — the rule was written into this file and the card fourteen
    lines above it was not converted.

    `:161` already carries "No measurement, no figure — not a figure of
    zero (M202)". This `?? []` — the same signature as M196's Add flow —
    survived the commit that wrote that sentence, and went on rendering
    "0 photographs in the archive" at 34px on a shelf that had failed to
    load. When a principle crystallises in a file, the nearest violations
    are the likeliest, because they are what you were looking at.
  */
  const channelsUnread = channelsPending || channelsFailed;
  const photographs = (channels ?? []).reduce(
    (n, c) => n + (c.photo_count ?? c.media_count ?? 0),
    0
  );

  return (
    /* Roster, as a test (owner, 2026-08-09: "let's test Insights as a
       roster page first"). The range segment stays at the title's right
       where M126 put it — the reclaimed height goes into the widgets,
       which the owner finds cramped, not into a control row. */
    <PageFrame
      type="roster"
      header={
        <PageHeader
          title="Insights"
          subtitle={`How ${subject} uses the archive, and where it needs feeding`}
          actions={
            /*
              Live since M115 strand 3: the route honours ?range, so each tab
              asks its own question and gets its own answer. These were
              disabled while only the week had a source — three tabs silently
              showing one number being the exact lie the mission ends.
            */
            <div
              className="flex items-center gap-1 rounded-full p-1"
              style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.08)" }}
            >
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className="rounded-full px-4 py-1.5 text-[13px] leading-none"
                  style={
                    range === r
                      ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                      : { color: "rgba(var(--ink-cream),.75)" }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          }
        />
      }
    >
      {!isAdmin && (
        <LockedNotice what="How the archive is used. Reading it is open to everyone helping." />
      )}
      {isPending && <p style={{ color: "var(--fg-soft)" }}>Loading…</p>}

      {/*
        Two rows that fill the action section exactly (M122).

        The cards used to carry their own minimum heights on a `flex-none`
        grid, so they took the height they wanted and the page took whatever
        was left — which on this page was about 100px of nothing, and the
        owner read that emptiness as a rendering fault rather than as design.

        `flex-1` with two equal rows inverts it: the action section decides,
        and each card is half of whatever it offers. That is what makes the
        page fill its frame at any height instead of only at the one the
        minimums were chosen for.
      */}
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-5 short:gap-4">
        {/* ── Time with the archive — real ─────────────────────────────── */}
        {/*
          `overflow-hidden` + `min-h-0` on the ring row: M122's rows are
          `minmax(0, 1fr)`, so at exactly the frame's height this card is a
          few pixels shorter than its content wanted — and without a clip
          the two sentences rendered on top of the Additions card below.
          The squeeze lands on the ring row's whitespace; the sentences are
          facts and stay whole.
        */}
        <BentoCard className="flex flex-col overflow-hidden p-7 short:p-6">
          <span className="flex-none text-[17px]" style={{ color: "var(--cream)" }}>
            Time with the archive
          </span>

          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Ring
              seconds={period?.seconds ?? 0}
              dialHours={DIAL_HOURS[range]}
              phrase={phrase}
              // No measurement, no figure — not a figure of zero (M202).
              unknown={isError || (isPending && !period)}
            />
          </div>

          {/*
            Two sentences, because they are two measurements (M115/F31).

            This used to read "daily average X · N visits across M channels",
            gluing screen-awake minutes to channel-visit counts — one number
            that sounded like an hour spent inside those channels. It wasn't:
            the screen being awake and someone looking at a channel are
            different events in different tables, and they disagreed by half
            an hour. Each fact now carries its own total.
          */}
          <div className="flex-none text-[13px] leading-[1.5]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
            {period && (period.seconds > 0 || period.visits > 0) ? (
              <>
                <span className="block">
                  Screen on for {hoursMinutes(period.seconds)} across {period.sessions}{" "}
                  {period.sessions === 1 ? "session" : "sessions"}.
                </span>
                {/*
                  "Of that" would be the same mistake in smaller print. The
                  live archive reads 34 minutes of screen-on above 1h 05 of
                  channel time — channel visits are recorded by the display
                  and by whoever is browsing remotely, and an open visit is
                  capped rather than closed, so the two totals do not nest.
                  Neither is wrong; they are simply not the same quantity.
                */}
                <span className="block" style={{ color: "var(--fg-hint)" }}>
                  Channels open for {hoursMinutes(period.channel_seconds)} — {period.visits}{" "}
                  {period.visits === 1 ? "visit" : "visits"} across {period.channels}{" "}
                  {period.channels === 1 ? "channel" : "channels"}.
                </span>
              </>
            ) : isError ? (
              /*
                M197 named this one: the sentence is about *her*, and a
                failed request used to say it. "The screen has not been on"
                is a claim about how Margaret spent her week — the worst
                kind to invent, and invisible to the backstop because it
                never says "No" or "Nothing".
              */
              <>This could not be loaded, so we cannot say.</>
            ) : (
              <>The screen has not been on {phrase}.</>
            )}
          </div>
        </BentoCard>

        {/* ── Watch rhythm — no source ─────────────────────────────────── */}
        <BentoCard className="flex flex-col p-7 short:p-6" {...placeholderProps("insights.watchRhythm")}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px]" style={{ color: "var(--cream)" }}>
              Watch rhythm
            </span>
            <span className="truncate text-[12px]" style={{ color: "var(--fg-hint)" }}>
              {subject} sits down after lunch, around 14:00
            </span>
          </div>
          <Bars
            values={[38, 52, 30, 61, 100, 44, 48]}
            labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
            peak={4}
          />
        </BentoCard>

        {/* ── What she returns to — real ───────────────────────────────── */}
        <BentoCard className="flex flex-col p-7 short:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px]" style={{ color: "var(--cream)" }}>
              What {subject} returns to
            </span>
            {/* The window, said out loud — it was a 30-day list under a tab
                that said "This week". It follows the live range now, and the
                label is here so the next range change cannot go silent. */}
            <span className="text-[11px]" style={{ color: "var(--fg-quiet)" }}>
              {phrase}
            </span>
          </div>

          {/*
            The list scrolls inside its card and ends in a fade (owner).

            It had `flex-1` and no overflow rule, so a fixed-height bento cell
            drew as many rows as it liked and the card's edge sliced the last
            one through the middle of its words — which reads as a broken
            render, not as "there are more". Now the overflow belongs to the
            list, and `fade-bottom` dissolves the final few pixels so the cut
            is deliberate and legible as "keep going".
          */}
          <ul className="scroll-thin fade-bottom mt-4 flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1 short:mt-2.5 short:gap-2">
            {returns.map((c) => (
              <li key={c.id} className="flex items-center gap-3.5">
                <span
                  className="flex-none rounded-[8px] px-2 py-1.5 font-mono text-[12px] leading-none"
                  style={{ background: "rgba(var(--ink),.07)", color: "rgba(var(--ink-cream),.8)" }}
                >
                  {String(c.number).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] leading-tight short:text-[13px]" style={{ color: "var(--cream)" }}>
                    {c.title}
                  </span>
                  <span className="block text-[12px] leading-tight short:text-[11px]" style={{ color: "var(--fg-hint)" }}>
                    {hoursMinutes(c.seconds)} over {c.visits} {c.visits === 1 ? "visit" : "visits"}
                  </span>
                </span>
                <span className="flex-none text-[13px]" style={{ color: "var(--accent-soft)" }}>
                  {c.visits}×
                </span>
              </li>
            ))}
            {returnsState === "error" && (
              <li className="text-[13px]" style={{ color: "var(--fg-soft)" }}>
                This could not be loaded, so we cannot say what she has opened.
              </li>
            )}
            {returnsState === "empty" && (
              <li className="text-[13px]" style={{ color: "var(--fg-soft)" }}>
                Nothing has been opened yet {phrase}.
              </li>
            )}
          </ul>
        </BentoCard>

        {/* ── Additions — no source ────────────────────────────────────── */}
        <BentoCard className="flex flex-col p-7 short:p-6" {...placeholderProps("insights.additions")}>
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            Additions
          </span>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="text-[34px] font-light short:text-[26px]" style={{ color: channelsUnread ? "rgba(var(--ink-cream),.35)" : "var(--cream)" }}>
              {channelsUnread ? "—" : photographs}
            </span>
            <span className="text-[13px]" style={{ color: "var(--fg-soft)" }}>
              {channelsUnread ? "photographs — not known" : "photographs in the archive"}
            </span>
          </div>
          <Bars
            values={[30, 45, 38, 22, 55, 100]}
            labels={["M", "A", "M", "J", "J", "A"]}
            peak={5}
          />
        </BentoCard>

        {/* ── Described — the content stream's own share (M103) ─────────── */}
        <BentoCard className="flex flex-col p-7 short:p-6">
          <div className="flex items-baseline justify-between">
            <span className="text-[17px]" style={{ color: "var(--cream)" }}>
              Described
            </span>
            <span className="text-[30px] font-light" style={{ color: "var(--cream)" }}>
              {content?.described.pct === null || content === undefined
                ? "—"
                : `${content.described.pct}%`}
            </span>
          </div>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full"
            style={{ background: "rgba(var(--ink),.09)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${content?.described.pct ?? 0}%`, background: "var(--accent)" }}
            />
          </div>
          <p className="mt-4 text-[13px] leading-[1.5]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
            Descriptions are what the frame reads aloud when {subject} asks.
          </p>
        </BentoCard>

        {/* ── The nudge — no source ────────────────────────────────────── */}
        <CreamInset className="flex flex-col p-7 short:p-6" {...placeholderProps("insights.nudge")}>
          <span className={CAPS} style={{ color: "rgba(var(--on-panel-alt-channels),.55)" }}>
            THIS WEEK'S NUDGE
          </span>
          <p className="mt-6 flex-1 text-[17px] font-light italic leading-[1.45]">
            New photos land best before lunch — this week's additions were on {subject}'s screen
            the same day.
          </p>
          <div className="flex items-end justify-between gap-3">
            <span className="text-[12px]" style={{ color: "rgba(var(--on-panel-alt-channels),.5)" }}>
              Based on the last 4 weeks
            </span>
            <Link
              to="/admin/missions"
              className="rounded-full px-5 py-[11px] text-[13px] font-medium"
              style={{ background: "var(--on-cream)", color: "var(--cream)" }}
            >
              Make it a mission
            </Link>
          </div>
        </CreamInset>
      </div>
    </PageFrame>
  );
}

/** A drawn arc — static, per the charter. The dial is an hour a day of the
 *  live window, so every tab's arc means the same thing at its own scale. */
export function Ring({
  seconds,
  dialHours,
  phrase,
  unknown = false,
}: {
  seconds: number;
  dialHours: number;
  phrase: string;
  /**
   * The measurement never arrived (M202).
   *
   * `seconds ?? 0` used to make this dial draw an empty ring and the words
   * "0 min", directly above a sentence saying the figure could not be
   * loaded. The page corrected itself in prose and asserted the falsehood
   * in numerals, larger — and the numeral is what a person reads. It is a
   * claim about how Margaret spent her week, which is the worst kind to
   * invent.
   *
   * This is the completion of M197's limit: the class was never lexical.
   * No backstop keyed on "No" or "Nothing" will ever catch `0 min`, and
   * that is exactly why the failed state has to be *looked at* (M199).
   */
  unknown?: boolean;
}) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const percent = unknown
    ? 0
    : Math.max(0, Math.min(100, (seconds / (dialHours * 3600)) * 100));

  return (
    <div className="relative">
      <svg width="170" height="170" viewBox="0 0 160 160" aria-hidden>
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(var(--ink),.08)" strokeWidth="11" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="var(--accent-soft)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${(c * percent) / 100} ${c}`}
          transform="rotate(-90 80 80)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[32px] font-light"
          style={{ color: unknown ? "rgba(var(--ink-cream),.35)" : "var(--cream)" }}
        >
          {unknown ? "—" : hoursMinutes(seconds)}
        </span>
        {/*
          "Screen on", not "watched". This dial sums device_sessions — how
          long the display was awake. Whether anyone was in the room, let
          alone looking, is not something the archive measures, and the old
          label claimed it did.
        */}
        <span className="text-[11px]" style={{ color: "var(--fg-soft)" }}>
          {unknown ? "not known" : `screen on ${phrase}`}
        </span>
      </div>
    </div>
  );
}

/** Vertical bars with one highlighted. Heights are percentages, drawn static. */
export function Bars({
  values,
  labels,
  peak,
}: {
  values: number[];
  labels: string[];
  peak: number;
}) {
  return (
    <div className="mt-auto flex items-end gap-3 pt-6 short:pt-3">
      {values.map((v, i) => (
        <div key={labels[i] + i} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-[110px] w-full items-end justify-center short:h-[62px]">
            <span
              className="w-[6px] rounded-full"
              style={{
                height: `${v}%`,
                background: i === peak ? "var(--accent-soft)" : "rgba(var(--ink),.22)",
              }}
            />
          </div>
          <span
            className="text-[12px]"
            style={{ color: i === peak ? "var(--accent-soft)" : "var(--fg-soft)" }}
          >
            {labels[i]}
          </span>
        </div>
      ))}
    </div>
  );
}
