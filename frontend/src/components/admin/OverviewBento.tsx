import { useState } from "react";
import { ChevronDown, ImageIcon, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import {
  useChannels,
  useEngagementStream,
  useMissions,
  useNfcCards,
  useScreenState,
  useDeviceStream,
} from "@/hooks/useAdminData";
import { useDisplay } from "@/lib/DisplayContext";
import { durationLabel } from "@/lib/labels";
import { MissionMark } from "./kit";

/*
  `overflow-hidden` is the protective mechanism, not a detail (owner, 17 Sep
  2026: "the elements cannot just float outside it doesn't make any sense").
  These cards sit in a grid whose rows shrink to the viewport, so any card
  whose content outgrows its row used to paint straight over its neighbours —
  the "Change channel" button landed on the calendar below. A card now clips
  what it cannot hold, and the text inside is written to give way first.
*/
const CARD =
  "rounded-[26px] border border-[rgba(var(--ink),.09)] bg-[rgba(var(--ink),.045)] box-border overflow-hidden";
const CAPS = "font-mono text-[10px] tracking-[0.16em]";

/**
 * The 20a bento: what her screen is doing, how long she sat with it, and
 * what the family could do next — the three things the Overview exists to
 * answer, in the frame's own arrangement.
 *
 * Where a value has a live source it is the archive's own. Where it does not
 * yet, the element is drawn as designed and registered in `placeholder.ts`,
 * so `document.querySelectorAll("[data-placeholder]")` will always name
 * everything on this screen that is not yet measured.
 */
export function OverviewBento() {
  const { subjectName } = useDisplay();
  const { data: channels } = useChannels();
  const { data: screen, isError: screenFailed } = useScreenState();
  const { data: missions, isPending: missionsPending, isError: missionsFailed } = useMissions();
  const { data: cards, isPending: cardsPending, isError: cardsFailed } = useNfcCards();
  /* The screen's own facts: paired, online, and which build it reports. */
  /*
    "Offline" is a claim about the screen in her living room (M213's
    census). `device?.display.online ? "Online" : "Offline"` answers
    "Offline" for a read that never arrived — sending somebody to check a
    display that is working perfectly.
  */
  const { data: device, isPending: devicePending, isError: deviceFailed } = useDeviceStream();
  const deviceUnread = devicePending || deviceFailed;

  /*
    Which settings section is unfolded. One at a time (M113) — see the note
    on the accordion card below. "Display" is the one that matters first: it
    is the answer to "is her screen alive?".
  */
  const [section, setSection] = useState("Display");
  /*
    "0 min watched today" and "No time at the screen yet today" are claims
    about how Margaret spent her day, and both were rendered from an
    unguarded read (M213's sweep, M202's class). The masthead's figures were
    fixed; this card, one component away, was not.
  */
  const {
    data: engagement,
    isPending: engagementPending,
    isError: engagementFailed,
  } = useEngagementStream();
  const engagementUnread = engagementPending || engagementFailed;

  /*
   * Fed by M103's engagement stream — the register entries retire.
   *
   * The ring's arc is today against her own best day of the last seven, so
   * it speaks only of her rhythm: no invented denominator, no target she is
   * being measured toward. A quiet week draws an empty ring honestly.
   */
  const watchedSeconds = engagement?.watched_today.seconds ?? 0;
  const bestDaySeconds = Math.max(
    watchedSeconds,
    ...(engagement?.by_day ?? []).map((d) => d.seconds)
  );
  const ringPercent = bestDaySeconds > 0 ? Math.round((watchedSeconds / bestDaySeconds) * 100) : 0;
  const sit = engagement?.longest_sit ?? null;

  const all = channels ?? [];
  const liveNumber = screen?.current_channel_number ?? screen?.last_channel_number ?? null;
  const live = all.find((c) => c.number === liveNumber) ?? null;
  const subject = subjectName?.trim() || "the archive";

  /*
    The board's three states, in the order work moves through them: done,
    in progress, still to do. The bar is those three shares — a segment is
    as wide as its share of the whole, so the shape of the bar *is* the
    shape of the backlog rather than a decoration sized by hand.
  */
  /*
    The bar and its percentages are figures too (F87/M205), and the same
    `?? []` signature as everywhere else in this class. `total` is 0 on a
    failed load, so "0/0" and a 0% bar read as a family who has finished
    nothing — rather than as a list nobody could read.
  */
  const missionsUnread = missionsPending || missionsFailed;
  const cardsUnread = cardsPending || cardsFailed;
  const rows = missions ?? [];
  const done = rows.filter((m) => m.status === "completed");
  const doing = rows.filter((m) => m.status === "in_progress");
  const todo = rows.filter((m) => m.status !== "completed" && m.status !== "in_progress");
  const open = rows.filter((m) => m.status !== "completed");
  const total = rows.length;
  const percent = total ? Math.round((done.length / total) * 100) : 0;

  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const segments = [
    /*
      Only the first segment carries a word, as the frame has it.

      Naming all three truncated the middle one to "I.." the moment work was
      unevenly spread — and a label that cannot be read is worse than none,
      because the percentage above already says which share this is. The
      title attribute keeps the name reachable for anyone who wants it.
    */
    { key: "done", label: "Done", title: "Done", count: done.length, style: { background: "var(--accent)", color: "#fff" } },
    { key: "doing", label: "", title: "In progress", count: doing.length, style: { background: "rgba(var(--ink),.09)", color: "var(--cream)" } },
    { key: "todo", label: "", title: "To do", count: todo.length, style: { border: "1px solid rgba(var(--ink),.12)", color: "rgba(var(--ink-cream),.75)" } },
  ].filter((s) => s.count > 0);

  return (
    /*
      Rows fill the height they are given, down to a floor.

      This line has been both extremes. Pure fractions (`1.06fr .94fr`)
      shrank every card until its contents spilled on a short screen; pure
      minimums (`minmax(300px,auto)`) pushed the bottom row past the fold, so
      the page grew a scrollbar. `minmax(280px,13fr)` then kept the floors and
      merely moved the failure: below the floors the grid overflowed its
      clipping parent and the bottom row was sliced off — the black bar the
      owner is pointing at.

      A dashboard is read, not scrolled, so the floors are gone. `minmax(0,fr)`
      lets both rows shrink to whatever the viewport actually offers, and the
      cards inside are built to survive it: the settings card shows one open
      section (M113), and the ring and mission list clip their own overflow.
      13:11 keeps the frame's proportion at every height.
    */
    <div className="grid min-h-0 flex-1 grid-cols-[290px_1fr_1fr_350px] grid-rows-[minmax(0,13fr)_minmax(0,11fr)] gap-4">
      {/* ── On her screen now ─────────────────────────────────────────── */}
      <div className={`${CARD} col-span-2 row-start-1 flex gap-6 p-[22px_24px] short:p-[14px_18px]`}>
        <div
          /* Shrinks with the card rather than holding 250px and leaving the
             title a three-character column. */
          className="relative w-[clamp(110px,34%,250px)] flex-none overflow-hidden rounded-[18px]"
          style={{ border: "1px solid rgba(var(--ink),.1)" }}
        >
          {live?.cover_url ? (
            <img src={live.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[rgba(var(--ink),0.03)]">
              <ImageIcon className="h-7 w-7" style={{ color: "rgba(var(--ink-cream),.3)" }} aria-hidden />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className={`${CAPS} flex items-center gap-2.5`} style={{ color: "var(--accent-soft)" }}>
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: "var(--accent-soft)",
                boxShadow: "0 0 10px rgba(226,154,104,.9)",
              }}
            />
            ON {subject.toUpperCase()}'S SCREEN NOW
          </div>

          {live ? (
            <>
              <div className="mt-4 flex items-center gap-3 short:mt-2.5">
                <span
                  className="flex-none rounded-[9px] px-2.5 py-2 font-mono text-[13px] font-medium leading-none"
                  style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}
                >
                  {String(live.number).padStart(2, "0")}
                </span>
                <span
                  className="line-clamp-2 min-w-0 text-[26px] font-semibold leading-[1.05] short:text-[21px]"
                  style={{ color: "var(--cream)", letterSpacing: "-.015em" }}
                  title={live.title}
                >
                  {live.title}
                </span>
              </div>
              <div className="mt-2.5 truncate text-[13px] leading-[1.5] short:mt-1.5 short:text-[12px]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
                {live.content_type} · {live.photo_count ?? live.media_count ?? 0} photographs
              </div>

              <div className="mt-auto">
                {/*
                  Real since 040: the display reports its position as she
                  moves through the album, and this line reads the report.
                  When no position has been reported the line stays absent —
                  the fixed "PHOTO 4 OF n" it used to show was a registered
                  holder, and a silent gap beats a confident guess.
                */}
                {screen?.photo_index !== null &&
                  screen?.photo_index !== undefined &&
                  screen?.photo_count !== null &&
                  screen?.photo_count !== undefined && (
                    <div
                      className="font-mono text-[9px] font-medium tracking-[0.15em]"
                      style={{ color: "var(--fg-hint)" }}
                    >
                      NOW SHOWING · PHOTO {screen.photo_index + 1} OF {screen.photo_count}
                    </div>
                  )}
                {/*
                  The description is what gives way. It ends in an ellipsis
                  rather than growing, because the one thing that must not
                  move is the button under it.
                */}
                <p
                  className="mt-1.5 line-clamp-3 text-[17px] font-light italic leading-[1.45] short:mt-1 short:line-clamp-2 short:text-[14px]"
                  style={{ color: "rgba(var(--ink-cream),.85)" }}
                  title={live.description || undefined}
                >
                  {live.description || "—"}
                </p>
              </div>
            </>
          ) : (
            <p className="mt-4 text-[15px]" style={{ color: "var(--fg-soft)" }}>
              {/* M182: a screen we cannot reach is not a screen showing nothing. */}
              {screenFailed
                ? "We cannot reach the screen just now."
                : "Nothing is on the screen just now."}
            </p>
          )}

          {/* flex-none: the row the owner asked to hold still. */}
          <div className="mt-4 flex flex-none justify-end short:mt-2.5">
            <Link
              to="/admin/shelf"
              className="rounded-full px-5 py-2.5 text-[13px] font-medium"
              style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
            >
              Change channel
            </Link>
          </div>
        </div>
      </div>

      {/* ── Time with the archive ─────────────────────────────────────── */}
      <div className={`${CARD} col-start-3 row-start-1 flex flex-col p-[22px_24px] short:p-[14px_18px]`}>
        <div className="flex items-start justify-between">
          <span className="text-[17px] short:text-[15px]" style={{ color: "var(--cream)" }}>
            Time with the archive
          </span>
          <Link
            to="/admin/insights"
            aria-label="Open Insights"
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ border: "1px solid rgba(var(--ink),.13)" }}
          >
            <ArrowUpRight size={14} style={{ color: "rgba(var(--ink-cream),.75)" }} aria-hidden />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <DashedRing
            percent={engagementUnread ? 0 : ringPercent}
            label={engagementUnread ? "—" : durationLabel(watchedSeconds)}
            sub={engagementUnread ? "not known" : "watched today"}
          />
        </div>

        <div className="text-[13px]" style={{ color: "rgba(var(--ink-cream),.72)" }}>
          {sit
            ? `Longest sit: ${Math.max(1, Math.round(sit.seconds / 60))} min` +
              (sit.channel_number !== null
                ? ` · Channel ${String(sit.channel_number).padStart(2, "0")}`
                : "")
            : engagementUnread
              ? "Her time at the screen could not be read."
              : "No time at the screen yet today"}
        </div>
      </div>

      {/* ── Missions ──────────────────────────────────────────────────── */}
      <div className={`${CARD} col-start-4 row-span-2 row-start-1 flex flex-col p-[22px_24px] short:p-[14px_18px]`}>
        <div className="flex items-baseline justify-between">
          <span className="text-[17px]" style={{ color: "var(--cream)" }}>
            Missions
          </span>
          <span className="text-[26px] font-medium" style={{ color: "var(--cream)" }}>
            {missionsUnread ? "—" : `${percent}%`}
          </span>
        </div>

        {/*
          One bar divided, not three chips (F26 closure).

          The Done segment wore the amber filled pill this app uses for
          things you press, so a legend was dressed as a button. It keeps the
          frame's colour and its word, but the segments now butt together
          into a single track with only the outer corners rounded, and the
          cursor stays default — a bar reads as a measurement, a pill reads
          as an invitation.
        */}
        <div className="mt-3 flex cursor-default overflow-hidden rounded-[10px]">
          {segments.map((s) => (
            <div key={s.key} style={{ flex: `${s.count} 1 0%`, minWidth: 0 }}>
              <div
                className="flex items-baseline gap-1.5 pb-1.5 text-[12px]"
                style={{ color: "var(--fg-soft)" }}
              >
                <span style={{ color: "rgba(var(--ink-cream),.28)" }}>|</span>
                {share(s.count)}%
              </div>
              <div
                title={`${s.title} — ${s.count}`}
                className="flex h-9 items-center overflow-hidden px-3 text-[12px] font-medium"
                // Square: the track above is rounded and clips, so the ends
                // come out right and the joins stay flush.
                style={s.style}
              >
                <span className="truncate">{s.label}</span>
              </div>
            </div>
          ))}
          {segments.length === 0 && (
            <div className="h-9 flex-1" style={{ background: "rgba(var(--ink),.05)" }} />
          )}
        </div>

        {/* The cream inset: the dark card inverted, as the frame draws it. */}
        <div className="panel-inverted mt-4 flex min-h-0 flex-1 flex-col rounded-[18px] p-4" style={{ background: "var(--panel-pale)" }}>
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-medium" style={{ color: "var(--on-cream)" }}>
              Mission list
            </span>
            <span className="text-[13px]" style={{ color: "rgba(var(--on-panel-alt-channels),.55)" }}>
              {missionsUnread ? "—" : `${done.length}/${total}`}
            </span>
          </div>

          <ul className="scroll-thin mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {[...done.slice(0, 1), ...open].slice(0, 5).map((m) => {
              const isDone = m.status === "completed";
              return (
                <li key={m.id} className="flex items-start gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span
                      className="block text-[13px] leading-[1.35]"
                      style={{
                        color: "var(--on-cream)",
                        textDecoration: isDone ? "line-through" : undefined,
                        opacity: isDone ? 0.55 : 1,
                      }}
                    >
                      {m.title}
                    </span>
                  </span>
                  <MissionMark
                    className="mt-0.5"
                    state={isDone ? "done" : m.status === "in_progress" ? "doing" : "open"}
                  />
                </li>
              );
            })}
            {total === 0 && (
              <li className="text-[13px]" style={{ color: "rgba(var(--on-panel-alt-channels),.55)" }}>
                Nothing waiting.
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* ── Accordions ────────────────────────────────────────────────── */}
      {/*
        One section open at a time, and no scrollbar (M113).

        The card's height comes from its grid row, so two or three sections
        unfolded used to overrun its rounded edge; the first fix gave the card
        its own scrollbar, which is the thing the owner is objecting to. A
        scrollbar inside a dashboard card hides content behind an interaction
        nobody performs — you read a dashboard, you do not scroll it.

        Single-open is what makes containment structural instead: exactly one
        body is ever rendered, so the tallest the card can be is four summary
        rows plus the one open body, which fits its slot by construction.
        Dropping "Family circle" (the owner's call — too many elements) buys
        the remaining three the room to breathe.
      */}
      <div className={`${CARD} col-start-1 row-start-2 flex min-h-0 flex-col overflow-hidden p-[18px_20px] short:p-[12px_16px]`}>
        {/* "Storage & backup" stood here until the owner dropped it (M132/Q7
            item 3). It was an honest placeholder — 4.2 GB and a backup date
            nothing measured — and the decision was that the fact itself is
            not wanted, so the element goes rather than waiting for a source.
            Its register key went with it. */}
        <Accordion label="Display" openSection={section} onOpen={setSection}>
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
              style={{ background: "rgba(var(--accent-channels),.16)" }}
            >
              <span className="h-3 w-4 rounded-[2px]" style={{ border: "1.5px solid var(--accent-soft)" }} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px]" style={{ color: "var(--cream)" }}>
                Living-room display
              </span>
              <span
                className="block text-[11px]"
                style={{ color: "var(--fg-soft)" }}
              >
                {/*
                  Real since 041: the screen reports its build when it opens
                  a channel. A machine that has never reported — paired
                  before the column existed, or on an older build — shows
                  only its online state, because "software —" would be a
                  worse answer than not raising the subject.
                */}
                {deviceUnread ? "Not known" : device?.display.online ? "Online" : "Offline"}
                {device?.software_version ? ` · software ${device.software_version}` : ""}
              </span>
            </span>
          </div>
        </Accordion>
        <Accordion label="Connected cards" openSection={section} onOpen={setSection} last>
          <div className="text-[12px]" style={{ color: "var(--fg-soft)" }}>
            {cardsUnread
              ? "Not known — the cards could not be read."
              : `${(cards ?? []).filter((c) => c.channel_id).length} of ${(cards ?? []).length} linked`}
          </div>
        </Accordion>
      </div>

      {/* ── This week ─────────────────────────────────────────────────── */}
      <WeekCard />
    </div>
  );
}

/** A static arc — a drawn ring, not a spinner (charter: no motion). */
function DashedRing({ percent, label, sub }: { percent: number; label: string; sub: string }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative">
      {/* The ring is the one fixed block in this card, so on a short screen
          it is what has to give: the viewBox does the scaling and the arc
          keeps its proportions (M131). */}
      <svg
        width="160"
        height="160"
        viewBox="0 0 160 160"
        className="h-[160px] w-[160px] short:h-[112px] short:w-[112px]"
        aria-hidden
      >
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgba(var(--ink),.08)" strokeWidth="10" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="var(--accent-soft)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(c * percent) / 100} ${c}`}
          transform="rotate(-90 80 80)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-light short:text-[22px]" style={{ color: "var(--cream)" }}>
          {label}
        </span>
        <span className="text-[11px] short:text-[10px]" style={{ color: "var(--fg-soft)" }}>
          {sub}
        </span>
      </div>
    </div>
  );
}

/*
  A section of the settings card. Controlled, because "only one open" is a
  fact about the card rather than about any one section — `<details open>`
  left to itself lets all four stand open at once, which is how the card
  outgrew its slot in the first place.

  It stays a real <details>/<summary>: the disclosure semantics, keyboard
  behaviour and screen-reader announcement are already correct there, and
  re-implementing them on a <div> would lose all three. `onToggle` is where
  the single-open rule is enforced — the browser tells us it opened, and we
  make that the only open one.
*/
function Accordion({
  label,
  children,
  openSection,
  onOpen,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  openSection: string;
  onOpen: (next: string) => void;
  last?: boolean;
}) {
  const isOpen = openSection === label;
  return (
    <details
      open={isOpen}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) onOpen(label);
        else if (isOpen) onOpen("");
      }}
      className="group flex-none py-3"
      style={last ? undefined : { borderBottom: "1px dashed rgba(var(--ink),.12)" }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between text-[14px]" style={{ color: "var(--cream)" }}>
        {label}
        {/* Flipped, not spun: the open section's chevron points up (frame 1a),
            with no transition — a state, not a motion. */}
        <ChevronDown size={14} className="group-open:rotate-180" style={{ color: "var(--fg-quiet)" }} aria-hidden />
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/**
 * The week, and the two buttons that move it.
 *
 * Last and Next were text in pills — they looked pressable and were not,
 * which is the fault F26 caught three of. They are buttons now, and the
 * strip below actually shifts: the offset is the card's own state, and every
 * date is derived from it rather than from today.
 */
function WeekCard() {
  const [offset, setOffset] = useState(0);

  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);

  const label =
    offset === 0 ? "This week" : offset === -1 ? "Last week" : offset === 1 ? "Next week" : null;

  return (
    <div className={`${CARD} col-span-2 col-start-2 row-start-2 flex flex-col p-[18px_22px] short:p-[12px_16px]`}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          className="rounded-full px-3.5 py-1.5 text-[12px]"
          style={{ background: "rgba(var(--ink),.06)", color: "rgba(var(--ink-cream),.75)" }}
        >
          Last week
        </button>
        <span className="text-[15px]" style={{ color: "var(--cream)" }}>
          {label ? `${label} · ` : ""}
          {monday.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setOffset((o) => o + 1)}
          className="rounded-full px-3.5 py-1.5 text-[12px]"
          style={{ background: "rgba(var(--ink),.06)", color: "rgba(var(--ink-cream),.75)" }}
        >
          Next week
        </button>
      </div>
      <WeekStrip monday={monday} />
    </div>
  );
}

/** Mon–Sat with the hours down the side, carrying that week's activity. */
function WeekStrip({ monday }: { monday: Date }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="mt-3 grid min-h-0 flex-1 grid-cols-[44px_repeat(6,1fr)] gap-x-2 short:mt-2">
      <div />
      {days.map((d, i) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        // The same *day*, not merely the same date number — otherwise the 7th
        // of every month lights up as though it were today.
        const isToday = date.getTime() === today.getTime();
        return (
          <div key={d} className="text-center">
            <div className="text-[12px]" style={{ color: isToday ? "var(--accent-soft)" : "var(--fg-soft)" }}>
              {d}
            </div>
            <div className="text-[13px]" style={{ color: isToday ? "var(--accent-soft)" : "var(--cream)" }}>
              {date.getDate()}
            </div>
          </div>
        );
      })}

      {["9:00", "10:00", "11:00"].map((hour) => (
        <div key={hour} className="contents">
          <div className="pt-3 text-right text-[10px] short:pt-1.5" style={{ color: "rgba(var(--ink-cream),.35)" }}>
            {hour}
          </div>
          {days.map((d) => (
            <div key={d + hour} style={{ borderLeft: "1px dashed rgba(var(--ink),.07)" }} />
          ))}
        </div>
      ))}
    </div>
  );
}
