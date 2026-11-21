import { ChevronDown, Mic, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import {
  useChannels,
  useContentStream,
  useDeviceStream,
  useMissions,
  useNfcCards,
  usePeople,
  useSuggestions,
} from "@/hooks/useAdminData";
import { agoLabel } from "@/lib/labels";

const CAPS = "font-mono text-[9px] tracking-[0.14em]";

/** A stat pill's label sits above it, quiet and small. */
function Pill({
  label,
  children,
  width,
  pushRight = false,
}: {
  label: string;
  children: React.ReactNode;
  width?: number;
  /** The first pill carries the gap: the group sits opposite the ask bar. */
  pushRight?: boolean;
}) {
  return (
    <div
      style={{
        /* A width is a preference, not a floor: the pill may shrink and it
           may wrap, but it may never push a neighbour out of the row. */
        ...(width ? { width, maxWidth: "100%", flex: "0 1 auto", minWidth: 0 } : null),
        ...(pushRight ? { marginLeft: "auto" } : null),
      }}
    >
      <div className={`${CAPS} px-1 pb-2`} style={{ color: "var(--fg-soft)" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * The top of the 20a Overview: who is back, whose archive, how far along.
 *
 * The counts used to live in a left sidebar that 20a does away with — the
 * design gives every page its full width and puts the archive's size here
 * instead, beside the greeting, where it reads as context rather than as a
 * permanent instrument panel.
 *
 * Every number is the archive's own. The design frame shows 6 / 34 / 3 and a
 * described 71%; those are the mockup's example family, and rendering them
 * literally would be a dashboard that lies to whoever is looking at it.
 */
export function OverviewMasthead() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { subjectName } = useDisplay();
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const { data: missions, isPending: missionsPending, isError: missionsFailed } = useMissions();
  const { data: cards, isPending: cardsPending, isError: cardsFailed } = useNfcCards();
  const { data: suggestions } = useSuggestions();
  const { data: content, isPending: contentPending, isError: contentFailed } = useContentStream();
  const { data: device } = useDeviceStream();

  /*
    Every figure here waits for its own load (F87/M205).

    Measured on screen in the states harness: with the archive unreachable
    this masthead read "0 Channels · 0 Photographs · 0 Contributors",
    "NFC LINKED 0 of 0", "MISSIONS 0 of 0 done" — at 40px, on the first
    screen an administrator sees. Beside the same page in `ready` it reads
    8, 10, 5. Four separate claims about how much a family has gathered,
    every one of them invented from `?? []`.

    Each count is gated on ITS OWN query rather than on a page-wide flag:
    these are four different requests, and one failing says nothing about
    the other three. Showing what did arrive is right; the dash is only for
    the figure that is genuinely not known.
  */
  const unknown = "—";
  const shelfUnread = channelsPending || channelsFailed;
  const peopleUnread = peoplePending || peopleFailed;
  const cardsUnread = cardsPending || cardsFailed;
  const missionsUnread = missionsPending || missionsFailed;

  const all = channels ?? [];
  const photographs = all.reduce((n, c) => n + (c.photo_count ?? c.media_count ?? 0), 0);
  const contributors = (people ?? []).filter((p) => p.role !== "user").length;

  const allCards = cards ?? [];
  const linked = allCards.filter((c) => c.channel_id).length;

  const openMissions = (missions ?? []).filter((m) => m.status !== "completed").length;
  const doneMissions = (missions ?? []).filter((m) => m.status === "completed").length;
  const totalMissions = openMissions + doneMissions;
  const missionPercent = totalMissions ? Math.round((doneMissions / totalMissions) * 100) : 0;

  /*
   * Fed by M103's streams: the described share and the week's additions from
   * `content`, the synced line from `device`. Their placeholder-register
   * entries are retired — these are the archive's own numbers now.
   */
  const described = content?.described.pct ?? null;
  const lastSeen = device?.display.last_seen_at ?? null;
  void suggestions;

  const first = (profile?.name ?? "").trim().split(/\s+/)[0];
  const subject = subjectName?.trim() || null;

  return (
    <div className="flex-none">
      <div className="flex items-end justify-between">
        <div>
          <h1
            className="text-[44px] font-light leading-[1.05]"
            style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
          >
            Welcome back, <em className="italic">{first || "there"}</em>
          </h1>
          <div className="mt-3 flex items-center gap-[9px] text-[13px]">
            <button
              type="button"
              /* "Margaret's archive ⌄" opens the archive, not the profile
                 selector (owner-directed): pressing the archive's name was
                 answering "who am I" when the question is "whose archive is
                 this". Switching profiles is one explicit action on /users. */
              onClick={() => navigate("/admin/users")}
              className="inline-flex items-center gap-[7px] font-medium"
              style={{ color: "var(--cream)" }}
            >
              {subject ? `${subject}'s archive` : "This archive"}
              <ChevronDown size={11} strokeWidth={2} style={{ color: "rgba(var(--ink-cream),.7)" }} />
            </button>
            {/* Silent while loading rather than wrong for a frame. */}
            {device && (
              <span style={{ color: "var(--fg-soft)" }}>
                {lastSeen ? `· synced ${agoLabel(lastSeen)}` : "· not synced yet"}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-end gap-11">
          {[
            [shelfUnread ? unknown : all.length, all.length === 1 ? "Channel" : "Channels"],
            [
              shelfUnread ? unknown : photographs,
              photographs === 1 ? "Photograph" : "Photographs",
            ],
            [
              peopleUnread ? unknown : contributors,
              contributors === 1 ? "Contributor" : "Contributors",
            ],
          ].map(([value, label]) => (
            <div key={String(label)}>
              <span
                className="text-[40px] font-medium leading-none"
                style={{ color: "var(--cream)", letterSpacing: "-.02em" }}
              >
                {value}
              </span>
              <div className="mt-1.5 text-[12px]" style={{ color: "var(--fg-soft)" }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        Wraps rather than overlaps (owner, 17 Sep 2026). A 390px ask bar and
        four fixed-width pills on one non-wrapping row ran out of space below
        about 1100px and painted over each other — the counts sat on top of
        the search field. The row now wraps and the ask bar gives up width
        first, so the group reflows instead of colliding.
      */}
      <div className="mt-6 flex flex-wrap items-end gap-x-3.5 gap-y-4">
        {/*
          The ask bar opens the ask flow (8c→8a→8b, M104 arrived). It spent
          its holder period as a disabled input registered under
          `ask.retrieval`; the register entry retires with this. It stays a
          button rather than a live input on purpose — the asking happens on
          /admin/ask, where the mic, the recents and the dropdown live, and
          a second half-wired input here would drift from that one.
        */}
        <button
          type="button"
          onClick={() => navigate("/admin/ask")}
          aria-label={subject ? `Ask about ${subject}'s archive` : "Ask about this archive"}
          className="flex h-[52px] w-full min-w-[220px] max-w-[390px] flex-1 items-center gap-2.5 rounded-full pl-5 pr-1.5 text-left"
          style={{ background: "rgba(var(--ink),.06)", border: "1px solid rgba(var(--ink),.14)" }}
        >
          <Search size={15} strokeWidth={1.7} style={{ color: "var(--fg-soft)" }} aria-hidden />
          <span
            className="w-full text-[13px] font-light italic"
            style={{ color: "var(--fg-hint)" }}
          >
            {subject ? `Ask about ${subject}'s archive…` : "Ask about this archive…"}
          </span>
          <span
            aria-hidden
            className="ml-auto flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full"
            style={{ background: "var(--chip-round)" }}
          >
            <Mic size={18} strokeWidth={1.7} color="var(--on-chip-round)" />
          </span>
        </button>

        <Pill label="DESCRIBED" pushRight>
          {/* An archive with no photographs has no share to describe: "—". */}
          <div
            className="rounded-full px-5 py-[13px] text-[13px] font-medium leading-none"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {described === null ? "—" : `${described}%`}
          </div>
        </Pill>

        <Pill label="CARDS LINKED">
          <div
            className="rounded-full px-5 py-[13px] text-[13px] font-medium leading-none"
            style={{ background: "rgba(var(--ink),.09)", color: "var(--cream)" }}
          >
            {cardsUnread ? unknown : `${linked} of ${allCards.length}`}
          </div>
        </Pill>

        <Pill label="MISSIONS" width={270}>
          {/*
            Hatched, not filled: the bar is a texture with the done share laid
            over it, so a low number reads as "early" rather than as a gauge
            sitting near empty. Static — the charter defers motion.
          */}
          <div
            className="relative h-[41px] overflow-hidden rounded-full"
            style={{
              border: "1px solid rgba(var(--ink),.13)",
              backgroundImage:
                "repeating-linear-gradient(115deg, rgba(var(--ink),.09) 0 2px, transparent 2px 8px)",
            }}
          >
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: missionsUnread ? "0%" : `${missionPercent}%`,
                background: "rgba(var(--accent-channels),.28)",
              }}
            />
            <span
              className="absolute left-5 top-1/2 -translate-y-1/2 text-[13px] font-medium leading-none"
              style={{ color: "var(--cream)" }}
            >
              {missionsUnread ? unknown : `${doneMissions} of ${totalMissions} done`}
            </span>
          </div>
        </Pill>

        <Pill label="THIS WEEK">
          <WeekAdditions
            added={content?.additions.this_week ?? 0}
            // "None this week" is a claim about what the family did (M205).
            unknown={contentPending || contentFailed}
          />
        </Pill>
      </div>
    </div>
  );
}

/** Photographs and videos added this week — the content stream's own count. */
function WeekAdditions({ added, unknown }: { added: number; unknown: boolean }) {
  return (
    <div
      className="rounded-full px-5 py-[13px] text-[13px] font-medium leading-none"
      style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
    >
      {unknown ? "—" : added > 0 ? `+${added} photos` : "None this week"}
    </div>
  );
}
