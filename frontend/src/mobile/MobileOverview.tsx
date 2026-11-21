import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import {
  useChannels,
  useDeviceStream,
  useMissions,
  usePeople,
  useScreenState,
} from "@/hooks/useAdminData";
import { agoLabel } from "@/lib/labels";
import { useMobileUI } from "./MobileShell";
import { ShelfCardFull, NewChannelCard } from "./ShelfCardFull";
import { OverviewTiles } from "./OverviewTiles";
import type { Mission } from "@/hooks/useAdminData";
import type { Channel, SubjectProfile } from "@/types";
import { listState } from "@/lib/listState";

/*
 * Overview — the phone's landing screen, redrawn to the desktop's shape
 * (owner, 21 Sep 2026: "welcome back, Andy, and then the same structure as
 * the homepage desktop — modern, nice, smooth").
 *
 * The desktop Overview is a masthead and a bento: who is back, whose
 * archive, how big it is; then the things to do. The phone now reads the
 * same way, in one scrolling column: the greeting and the counts, the
 * shelf, the missions, and a grid of tiles for everything else. The centred
 * portrait with "Margaret Fournier · Born …" that used to open this
 * screen is gone — that is the subject's profile, and it has a page.
 *
 * Three sections went with it: READY FOR THE SCREEN, NEEDS ATTENTION and
 * RECENT ACTIVITY. They were lists to read on the screen a family opens to
 * do something, and each already has a home (Missions, Activity). Their
 * place is taken by the tiles (OverviewTiles), which cover every
 * destination behind More.
 */

const LABEL = "font-mono text-[10px] tracking-[0.16em] text-fg-faint";

/** "4 photos · “Margaret” · with Hélène" — from fields the API really has. */
function missionMeta(mission: Mission): string {
  const bits: string[] = [];
  if (
    mission.task_count &&
    (mission.task_kind === "describe_photos" || mission.task_kind === "add_photos")
  ) {
    bits.push(`${mission.task_count} photo${mission.task_count === 1 ? "" : "s"}`);
  }
  if (mission.channel) bits.push(`“${mission.channel.title}”`);
  if (mission.assignee) bits.push(`with ${mission.assignee.name}`);
  return bits.join(" · ");
}

/** SUGGESTED SUNDAY / IN PROGRESS — the status plus the day it appeared. */
function missionStatusLabel(mission: Mission): string {
  if (mission.status === "suggested") {
    const day = new Date(mission.created_at)
      .toLocaleDateString("en-GB", { weekday: "long" })
      .toUpperCase();
    return `SUGGESTED ${day}`;
  }
  return "IN PROGRESS";
}

/**
 * The desktop masthead at phone size: the greeting, whose archive it is, and
 * the three counts. Every figure waits for its own load (M205) — a request
 * that has not answered shows a dash, never a zero.
 */
function MobileMasthead() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { subjectName } = useDisplay();
  const { data: subject } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const { data: device } = useDeviceStream();

  const first = (profile?.name ?? "").trim().split(/\s+/)[0];
  const who = subjectName?.trim() || subject?.display_name?.trim() || null;
  const lastSeen = device?.display.last_seen_at ?? null;

  const all = channels ?? [];
  const photographs = all.reduce((n, c) => n + (c.photo_count ?? c.media_count ?? 0), 0);
  const contributors = (people ?? []).filter((p) => p.role !== "user").length;
  const shelfUnread = channelsPending || channelsFailed;
  const peopleUnread = peoplePending || peopleFailed;
  const unknown = "—";

  const counts: [string | number, string][] = [
    [shelfUnread ? unknown : all.length, all.length === 1 ? "Channel" : "Channels"],
    [shelfUnread ? unknown : photographs, photographs === 1 ? "Photograph" : "Photographs"],
    [peopleUnread ? unknown : contributors, contributors === 1 ? "Contributor" : "Contributors"],
  ];

  return (
    <section className="flex flex-col gap-5 pt-2">
      <div>
        <h1
          className="text-[34px] font-light leading-[1.05]"
          style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
        >
          Welcome back, <em className="italic">{first || "there"}</em>
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <button
            type="button"
            onClick={() => navigate("/admin/users")}
            className="inline-flex items-center gap-1.5 font-medium"
            style={{ color: "var(--cream)" }}
          >
            {who ? `${who}'s archive` : "This archive"}
            <ChevronDown size={11} strokeWidth={2} style={{ color: "rgba(var(--ink-cream),.7)" }} />
          </button>
          {device && (
            <span style={{ color: "var(--fg-soft)" }}>
              {lastSeen ? `· synced ${agoLabel(lastSeen)}` : "· not synced yet"}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {counts.map(([value, label]) => (
          <div
            key={label}
            className="rounded-[18px] px-3.5 py-3"
            style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
          >
            <span
              className="block text-[26px] font-medium leading-none"
              style={{ color: "var(--cream)", letterSpacing: "-.02em" }}
            >
              {value}
            </span>
            <span className="mt-1.5 block text-[11px]" style={{ color: "var(--fg-soft)" }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MobileOverview() {
  const navigate = useNavigate();
  const { openAdd } = useMobileUI();

  const { data: channels } = useChannels();
  const { data: missions, isPending: missionsPending, isError: missionsFailed } = useMissions();
  /*
    The LIVE guard (M213): a FAILED refetch keeps React Query's previous
    answer, and without this the strip would say a memory is on her screen
    now when it is not. A cold failure leaves `screen` undefined and claims
    nothing either way.
  */
  const {
    data: screen,
    isPending: screenPending,
    isError: screenFailed,
  } = useScreenState();
  const screenUnread = screenPending || screenFailed;

  // Live or last-watched first, then the shelf order the desktop uses.
  const liveNumber = screenUnread ? null : (screen?.current_channel_number ?? null);
  const lastNumber = screen?.last_channel_number ?? null;
  const strip = [...(channels ?? [])].sort((a, b) => {
    const rank = (c: Channel) =>
      c.number === liveNumber ? 0 : c.number === lastNumber ? 1 : 2;
    return rank(a) - rank(b) || a.number - b.number;
  });

  // The card pair (frame 16h): the suggested one leads, the one already in
  // motion sits second — a suggestion is an invitation, work in progress is
  // merely a fact.
  const open = (missions ?? [])
    .filter((m) => m.status !== "completed")
    .sort((a, b) => (a.status === "suggested" ? 0 : 1) - (b.status === "suggested" ? 0 : 1))
    .slice(0, 2);
  const missionsState = listState({
    isPending: missionsPending,
    isError: missionsFailed,
    count: open.length,
  });

  return (
    // The shell frames this page (M75); it carries content only.
    <div className="flex flex-col gap-[28px]">
      <MobileMasthead />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className={LABEL}>MEMORY SHELF</span>
          <Link to="/admin/shelf" className="text-[11px] text-[color:rgba(var(--ink),0.5)]">
            See all →
          </Link>
        </div>
        {/*
          The first card is whole; the peek is on the right (M70). The strip
          is pulled to the screen edges to go full-bleed, with a leading
          gutter and a trailing spacer so the cut lands on the NEXT card.
        */}
        <div className="thumb-strip -mx-[22px] flex gap-2.5 overflow-x-auto pl-[22px]">
          {strip.map((channel) => (
            <ShelfCardFull
              key={channel.id}
              channel={channel}
              live={channel.number === liveNumber}
              onPress={() => navigate("/admin/shelf")}
              // A strip: fixed 150×200, as frame 16h sizes it.
              className="h-[200px] w-[150px] flex-none"
            />
          ))}
          <NewChannelCard
            onPress={() => openAdd({ kind: "new" })}
            className="h-[200px] w-[150px] flex-none"
          />
          {/* Trailing padding on a horizontal scroller is unreliable across
              browsers; a spacer is not. */}
          <span aria-hidden className="w-[7px] flex-none" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className={LABEL}>MISSIONS</span>
          <Link to="/admin/missions" className="text-[11px] text-[color:rgba(var(--ink),0.5)]">
            See all →
          </Link>
        </div>
        {/* A pair, not a list: the lead card is filled amber, the second is
            quiet. One invitation at full volume is enough. */}
        <div className={`grid gap-2.5 ${open.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
          {open.map((mission, index) => {
            const lead = index === 0;
            const meta = missionMeta(mission);
            return (
              <button
                key={mission.id}
                type="button"
                onClick={() =>
                  mission.channel_id
                    ? navigate(`/admin/edit-channel/${mission.channel_id}`, {
                        state: { missionId: mission.id },
                      })
                    : navigate("/admin/missions")
                }
                className="pressable flex flex-col rounded-card border p-4 px-[18px] text-left"
                style={
                  lead
                    ? { background: "var(--accent)", borderColor: "var(--accent)" }
                    : { borderColor: "rgba(var(--ink),.16)" }
                }
              >
                <p
                  className="text-[14px] font-medium leading-[1.4]"
                  style={{ color: lead ? "var(--accent-foreground)" : "var(--fg)" }}
                >
                  {mission.title}
                </p>
                {meta && (
                  <p
                    className="mt-1.5 text-[12px] leading-[1.4]"
                    style={{ color: lead ? "var(--accent-foreground)" : "var(--fgw-quiet)", opacity: lead ? 0.8 : 1 }}
                  >
                    {meta}
                  </p>
                )}
                <span
                  className="mt-auto pt-2.5 font-mono text-[9px] tracking-[0.14em]"
                  style={{ color: lead ? "var(--accent-foreground)" : "var(--fgw-dim)", opacity: lead ? 0.7 : 1 }}
                >
                  {missionStatusLabel(mission)}
                </span>
              </button>
            );
          })}
        </div>
        {/* A load that did not arrive is not an empty list (F70, M197). */}
        {missionsState === "error" && (
          <p className="text-[13px] text-fg-faint">
            The missions could not be loaded just now.
          </p>
        )}
        {missionsState === "empty" && (
          <p className="text-[13px] text-fg-faint">
            Nothing waiting — new missions appear here.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <span className={LABEL}>THE ARCHIVE</span>
        <OverviewTiles />
      </section>
    </div>
  );
}
