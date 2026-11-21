import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDisplay } from "@/lib/DisplayContext";
import { useAuth } from "@/context/AuthContext";
import { useChannels, useContentStream, useInsights } from "@/hooks/useAdminData";
import { LockedNotice } from "@/components/admin/LockedNotice";
import { BentoCard, CreamInset } from "@/components/admin/kit";
import { placeholderProps } from "@/lib/placeholder";
import { listState } from "@/lib/listState";
import {
  Bars,
  DIAL_HOURS,
  hoursMinutes,
  RANGES,
  RANGE_KEY,
  RANGE_PHRASE,
  type Range,
} from "@/pages/admin/InsightsPage";

/*
 * Insights on a phone (M183, F71) — the owner's words: "maybe the card can
 * be stacked above each other and the width belongs to 1 card."
 *
 * The desktop is a 3×2 bento, and at 375px that is three ~100px columns. It
 * did not overflow, it *compressed* — which is why every automated check of
 * the broken page passed and the owner's eyes did not.
 *
 * So: one card per row, each with the whole width. Most of the six simply
 * relax into the extra room. Two do not, and get their own sizing here
 * rather than inheriting a cell's:
 *
 *  - the dial, which was drawn for a ~330px cell and looks marooned in the
 *    middle of a phone, so it is bigger;
 *  - "what she returns to", which scrolled inside a fixed cell on the
 *    desktop and has no reason to on a page that already scrolls — it shows
 *    its rows and lets the page carry them.
 *
 * The range tabs move above the cards, full width, because on a phone there
 * is no title bar to the right of.
 */

const CAPS = "font-mono text-[10px] tracking-[0.16em]";

/** The dial, sized for a phone rather than for a bento cell. */
function PhoneRing({
  seconds,
  dialHours,
  phrase,
  unknown = false,
}: {
  seconds: number;
  dialHours: number;
  phrase: string;
  /**
   * No measurement arrived (M202) — see `Ring` in `InsightsPage`.
   *
   * This twin is how I found out the desktop fix was not the fix: I
   * verified `Ring` at a phone width, saw "0 min" survive, and only the
   * font size gave it away — 34px here, 32px there. Same defect, same
   * file pair as M197's prose fix, and the same lesson as AdminUpload:
   * a bug found on one surface is a report about a pattern.
   */
  unknown?: boolean;
}) {
  const r = 76;
  const c = 2 * Math.PI * r;
  const percent = unknown
    ? 0
    : Math.max(0, Math.min(100, (seconds / (dialHours * 3600)) * 100));

  return (
    <div className="relative flex items-center justify-center">
      <svg width="200" height="200" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(var(--ink),.08)" strokeWidth="13" />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="var(--accent-soft)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${(c * percent) / 100} ${c}`}
          transform="rotate(-90 100 100)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[34px] font-light leading-none"
          style={{ color: unknown ? "rgba(var(--ink-cream),.35)" : "var(--cream)" }}
        >
          {unknown ? "—" : hoursMinutes(seconds)}
        </span>
        {/* "Screen on", not "watched" — the dial sums how long the display
            was awake, which is not the same as anyone looking at it. */}
        <span className="mt-1.5 text-[12px]" style={{ color: "var(--fg-soft)" }}>
          {unknown ? "not known" : `screen on ${phrase}`}
        </span>
      </div>
    </div>
  );
}

export function MobileInsights() {
  const { setStatus, subjectName } = useDisplay();
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
    // The shell frames the page (M75); this carries content only, and the
    // column is the layout — no grid, no columns, nothing to compress.
    <div className="flex flex-col gap-[22px]">
      <div>
        <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.01em]">Insights</h1>
        <p className="mt-1 text-[13px] text-fg-muted">
          How {subject} uses the archive, and where it needs feeding
        </p>
      </div>

      {/* Full width, because there is no title to sit beside. Three equal
          shares rather than a pill that runs off the edge. */}
      <div
        className="flex items-center gap-1 rounded-full p-1"
        style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.08)" }}
      >
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className="flex-1 rounded-full px-3 py-2 text-[13px] leading-none"
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

      {!isAdmin && (
        <LockedNotice what="How the archive is used. Reading it is open to everyone helping." />
      )}
      {isPending && <p style={{ color: "var(--fg-soft)" }}>Loading…</p>}

      {/* ── Time with the archive — real ──────────────────────────────── */}
      <BentoCard className="flex flex-col p-6">
        <span className="text-[17px]" style={{ color: "var(--cream)" }}>
          Time with the archive
        </span>
        <div className="my-5 flex justify-center">
          <PhoneRing
            seconds={period?.seconds ?? 0}
            dialHours={DIAL_HOURS[range]}
            phrase={phrase}
            // No measurement, no figure — not a figure of zero (M202).
            unknown={isError || (isPending && !period)}
          />
        </div>
        <div className="text-[13px] leading-[1.5]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
          {period && (period.seconds > 0 || period.visits > 0) ? (
            <>
              <span className="block">
                Screen on for {hoursMinutes(period.seconds)} across {period.sessions}{" "}
                {period.sessions === 1 ? "session" : "sessions"}.
              </span>
              {/* Two sentences because they are two measurements (M115/F31)
                  — screen-awake time and channel-visit time do not nest. */}
              <span className="mt-1 block" style={{ color: "var(--fg-hint)" }}>
                Channels open for {hoursMinutes(period.channel_seconds)} — {period.visits}{" "}
                {period.visits === 1 ? "visit" : "visits"} across {period.channels}{" "}
                {period.channels === 1 ? "channel" : "channels"}.
              </span>
            </>
          ) : isError ? (
            // M197: a failed request must not report on her week.
            <>This could not be loaded, so we cannot say.</>
          ) : (
            <>The screen has not been on {phrase}.</>
          )}
        </div>
      </BentoCard>

      {/* ── What she returns to — real ────────────────────────────────── */}
      <BentoCard className="flex flex-col p-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            What {subject} returns to
          </span>
          <span className="flex-none text-[11px]" style={{ color: "var(--fg-quiet)" }}>
            {phrase}
          </span>
        </div>

        {/* No inner scroller and no fade: the desktop needs those because the
            card is a fixed cell, and this page scrolls already. A list that
            scrolls inside a scrolling page is a trap on a touch screen. */}
        <ul className="mt-4 flex flex-col gap-3.5">
          {returns.map((c) => (
            <li key={c.id} className="flex items-center gap-3.5">
              <span
                className="flex-none rounded-[8px] px-2 py-1.5 font-mono text-[12px] leading-none"
                style={{ background: "rgba(var(--ink),.07)", color: "rgba(var(--ink-cream),.8)" }}
              >
                {String(c.number).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] leading-tight" style={{ color: "var(--cream)" }}>
                  {c.title}
                </span>
                <span className="block text-[12px] leading-tight" style={{ color: "var(--fg-hint)" }}>
                  {hoursMinutes(c.seconds)} over {c.visits} {c.visits === 1 ? "visit" : "visits"}
                </span>
              </span>
              <span className="flex-none text-[13px]" style={{ color: "var(--accent-soft)" }}>
                {c.visits}×
              </span>
            </li>
          ))}
          {/* M182: a list we could not read is not a list of nothing. */}
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

      {/* ── Described — the content stream's own share (M103) ─────────── */}
      <BentoCard className="flex flex-col p-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            Described
          </span>
          <span className="text-[30px] font-light leading-none" style={{ color: "var(--cream)" }}>
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

      {/* ── Watch rhythm — no source ──────────────────────────────────── */}
      <BentoCard className="flex flex-col p-6" {...placeholderProps("insights.watchRhythm")}>
        <span className="text-[17px]" style={{ color: "var(--cream)" }}>
          Watch rhythm
        </span>
        <span className="mt-1 text-[12px]" style={{ color: "var(--fg-hint)" }}>
          {subject} sits down after lunch, around 14:00
        </span>
        <Bars
          values={[38, 52, 30, 61, 100, 44, 48]}
          labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
          peak={4}
        />
      </BentoCard>

      {/* ── Additions — no source ─────────────────────────────────────── */}
      <BentoCard className="flex flex-col p-6" {...placeholderProps("insights.additions")}>
        <span className="text-[17px]" style={{ color: "var(--cream)" }}>
          Additions
        </span>
        <div className="mt-3 flex items-baseline gap-2.5">
          <span className="text-[34px] font-light leading-none" style={{ color: channelsUnread ? "rgba(var(--ink-cream),.35)" : "var(--cream)" }}>
            {channelsUnread ? "—" : photographs}
          </span>
          <span className="text-[13px]" style={{ color: "var(--fg-soft)" }}>
            {channelsUnread ? "photographs — not known" : "photographs in the archive"}
          </span>
        </div>
        <Bars values={[30, 45, 38, 22, 55, 100]} labels={["M", "A", "M", "J", "J", "A"]} peak={5} />
      </BentoCard>

      {/* ── The nudge — no source ─────────────────────────────────────── */}
      <CreamInset className="flex flex-col p-6" {...placeholderProps("insights.nudge")}>
        <span className={CAPS} style={{ color: "rgba(var(--on-panel-alt-channels),.55)" }}>
          THIS WEEK'S NUDGE
        </span>
        <p className="mt-4 text-[17px] font-light italic leading-[1.45]">
          New photos land best before lunch — this week's additions were on {subject}'s screen the
          same day.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <span className="text-[12px]" style={{ color: "rgba(var(--on-panel-alt-channels),.5)" }}>
            Based on the last 4 weeks
          </span>
          {/* Full width and thumb-sized, rather than a desktop pill wedged
              into a corner. */}
          <Link
            to="/admin/missions"
            className="rounded-full py-3 text-center text-[14px] font-medium"
            style={{ background: "var(--on-cream)", color: "var(--cream)" }}
          >
            Make it a mission
          </Link>
        </div>
      </CreamInset>
    </div>
  );
}
