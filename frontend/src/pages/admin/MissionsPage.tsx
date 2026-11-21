import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useChannels, useMissions, usePeople, type Mission } from "@/hooks/useAdminData";
import { listState } from "@/lib/listState";
import { InitialsAvatar } from "@/components/admin/InitialsAvatar";
import { Select } from "@/components/admin/Select";
import { missionDestination } from "@/components/admin/MissionBanner";
import { PageFrame, PageHeader, PrimaryPill, CAPS, MissionMark } from "@/components/admin/kit";
import { MobileMissions } from "@/mobile/MobileMissions";
import { useIsMobile } from "@/mobile/useIsMobile";

const LABEL = "font-mono text-[11px] tracking-[0.16em]";
const CHIP = "rounded-full px-3 py-1.5 font-mono text-[10px] leading-none";
const CHIP_STYLE = { background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.8)" };
const CHIP_STYLE_CREAM = { background: "rgba(var(--panel-wash-channels),.07)", color: "var(--on-panel-pale)" };

const TASK_LABEL: Record<string, (m: Mission) => string> = {
  describe_photos: (m) =>
    `TASK · ${m.task_count ?? "?"} description${m.task_count === 1 ? "" : "s"}`,
  link_nfc: () => "TASK · Link a card",
  add_photos: (m) => `TASK · ${m.task_count ? `${m.task_count} photos` : "Add photos"}`,
  record: () => "TASK · 1 recording",
  create_channel: () => "TASK · New channel",
  custom: () => "TASK",
};

/**
 * What a new mission can ask for. Each choice is a real task Recall can
 * detect the completion of — a mission is never a note, it is work that
 * finishes itself the moment the asked-for save happens.
 */
const TASK_CHOICES: { label: string; kind: Mission["task_kind"]; needsChannel: boolean }[] = [
  { label: "Describe photos", kind: "describe_photos", needsChannel: true },
  { label: "Add photos", kind: "add_photos", needsChannel: false },
  { label: "Record a message", kind: "record", needsChannel: false },
  { label: "Create a channel", kind: "create_channel", needsChannel: false },
  { label: "Link a card", kind: "link_nfc", needsChannel: true },
  { label: "Custom task", kind: "custom", needsChannel: false },
];

/**
 * What a typed title is probably asking for.
 *
 * Somebody writing "Record a message from Luc" under Custom task has
 * described a task Recall can detect the completion of — they just did not
 * reach for the dropdown. Recognising the verb and preselecting the kind
 * turns a mission that could only end by being dismissed into one that ends
 * by being done. A dumb keyword pass, at typing time, always overridable.
 */
const TITLE_HINTS: [RegExp, string][] = [
  [/\b(record|voice|message|audio|say|tell)\b/i, "Record a message"],
  [/\b(describe|caption|description|words)\b/i, "Describe photos"],
  [/\b(card|nfc|tag|link)\b/i, "Link a card"],
  [/\b(new channel|create a channel|make a channel)\b/i, "Create a channel"],
  [/\b(add|upload|photos|pictures|images|scan)\b/i, "Add photos"],
];

function guessTaskFromTitle(title: string): string | null {
  for (const [pattern, label] of TITLE_HINTS) {
    if (pattern.test(title)) return label;
  }
  return null;
}

/**
 * A done card always says what changed (owner's rule: the cards stand at one
 * height, and the report line is the difference). When nobody wrote a
 * sentence, one is built from the mission's own facts — the kind, the count,
 * the channel — so the line is a record, never filler. The one honest blank
 * left is a free-form task with no channel: it has no facts to speak of, and
 * the card reserves the line's height rather than inventing words.
 */
function doneDetail(m: Mission): string | null {
  if (m.detail) return m.detail;
  const channel = m.channel ? `“${m.channel.title}”` : null;
  switch (m.task_kind) {
    case "describe_photos":
      return m.task_count
        ? `${m.task_count} description${m.task_count === 1 ? "" : "s"} written${channel ? ` in ${channel}` : ""}.`
        : `The photographs${channel ? ` in ${channel}` : ""} have their words now.`;
    case "link_nfc":
      return channel ? `A card now opens ${channel} by touch.` : "A card is linked.";
    case "add_photos":
      return m.task_count
        ? `${m.task_count} photograph${m.task_count === 1 ? "" : "s"} added${channel ? ` to ${channel}` : ""}.`
        : `Photographs added${channel ? ` to ${channel}` : ""}.`;
    case "record":
      return "A voice recording joined the archive.";
    case "create_channel":
      return "A new channel stands on the shelf.";
    default:
      return channel ? `Finished, in ${channel}.` : null;
  }
}

/** "DONE · 2 DAYS AGO", the way the frame's done card reports it. */
function doneAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  if (days < 7) return `${days} DAYS AGO`;
  return new Date(iso)
    .toLocaleDateString("en-GB", { day: "numeric", month: "long" })
    .toUpperCase();
}

/**
 * Missions: the family's board of small, finishable work. Frame 1f draws it
 * as three columns — what is being done, what is waiting, and what got done,
 * which celebrates in cream. No "mark done" anywhere except free-form tasks —
 * a mission concludes when the save it asked for actually happens (a
 * description saved, a channel created, a card linked), or when somebody
 * dismisses it.
 */
export function MissionsPage() {
  /*
   * The branch, and nothing above it (M60).
   *
   * `useIsMobile` is the only hook this component may call. Everything the
   * desktop board needs lives in `MissionsDesktop`, so crossing the
   * breakpoint swaps one child for another instead of changing how many
   * hooks this function ran — which is what blanks a page with a hooks-order
   * error. The siblings hit this once already.
   */
  const isMobile = useIsMobile();
  return isMobile ? <MobileMissions /> : <MissionsDesktop />;
}

function MissionsDesktop() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { isAdmin, profile } = useAuth();
  const { data: missions, isPending, isError } = useMissions();
  /*
    Both feed pickers on the new-mission form (M219). Empty on a failed
    read, they say the archive has no memories and the family has nobody to
    assign — to somebody trying to hand a job to their sister.
  */
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const peopleSource = peoplePending ? "loading" : peopleFailed ? "failed" : "ready";
  const channelSource = channelsPending ? "loading" : channelsFailed ? "failed" : "ready";

  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [focusId, setFocusId] = useState<string | null>(
    (location.state as { focusId?: string } | null)?.focusId ?? null
  );
  /*
   * Which list you land on — the family's, then yours.
   *
   * This was the other way round (M54: "first my missions, then all"), on
   * the reasoning that your own work is what you came for. The owner has
   * reversed it: the board opens on **All open**, because the Missions page
   * is how the family sees what the archive needs, and a personal list is
   * the narrower question you ask second. So All open leads and is the
   * default; My missions is one press away and still remembers your choice
   * for the rest of the visit. A filter, not a route — the Done column
   * beside it never moves.
   */
  const [scope, setScope] = useState<"mine" | "all" | null>(null);
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<string | null>(null);
  // Which mission is asking "are you sure?" — the editor's idiom (M96).
  const [confirmDismiss, setConfirmDismiss] = useState<string | null>(null);

  /*
    Escape retreats, wherever the focus went.

    The confirm replaces the button that was clicked, so focus is left on a
    node that no longer exists and a local `onKeyDown` would never fire. A
    window listener is what makes "press Escape to back out" true rather than
    merely intended.
  */
  useEffect(() => {
    if (!confirmDismiss) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setConfirmDismiss(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDismiss]);

  const [title, setTitle] = useState("");
  const [taskChoice, setTaskChoice] = useState("Custom task");
  const [taskChosenByHand, setTaskChosenByHand] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [targetChannel, setTargetChannel] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The mission somebody pressed elsewhere announces itself, then settles.
  useEffect(() => {
    if (!focusId || !missions) return;
    const el = cardRefs.current.get(focusId);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setFocusId(null), 2500);
    return () => clearTimeout(t);
  }, [focusId, missions]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["missions"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  const chosen = TASK_CHOICES.find((c) => c.label === taskChoice) ?? TASK_CHOICES[4];
  const chosenChannel = (channels ?? []).find(
    (c) => `${String(c.number).padStart(2, "0")} · ${c.title}` === targetChannel
  );
  const channelMissing = chosen.needsChannel && !chosenChannel;

  const create = useMutation({
    mutationFn: () => {
      return api.post("/missions", {
        title: title.trim(),
        detail: null,
        status: assignee ? "in_progress" : "suggested",
        assigned_to: (people ?? []).find((p) => p.name === assignee)?.id ?? null,
        // A create-a-channel mission is about a channel that does not exist
        // yet — it never points at one.
        channel_id: chosen.kind === "create_channel" ? null : (chosenChannel?.id ?? null),
        task_kind: chosen.kind === "custom" && !chosenChannel ? null : chosen.kind,
        task_count:
          chosen.kind === "describe_photos" ? (chosenChannel?.undescribed_count ?? null) : null,
      });
    },
    onSuccess: () => {
      setTitle("");
      setTaskChoice("Custom task");
      setTaskChosenByHand(false);
      setAssignee("");
      setTargetChannel("");
      setAdding(false);
      setError(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/missions/${id}`, body),
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/missions/${id}`),
    onSuccess: refresh,
    onError: (err: Error) => setError(err.message),
  });

  /** Starting takes you to the exact place the mission happens. */
  function launch(mission: Mission) {
    if (mission.status === "suggested") {
      update.mutate({ id: mission.id, body: { status: "in_progress" } });
    }
    const destination = missionDestination(mission);
    if (destination) navigate(destination.path, { state: destination.state });
    // A mission with no destination simply starts; the board shows it moving.
  }

  const rows = missions ?? [];
  const missionsState = listState({ isPending, isError, count: rows.length });
  // What people are doing first, then what people planned, then what Recall
  // noticed on its own.
  const rank = (m: Mission) =>
    m.status === "in_progress" ? 0 : m.origin === "human" ? 1 : 2;
  const open = rows.filter((m) => m.status !== "completed").sort((a, b) => rank(a) - rank(b));
  const doneRows = rows.filter((m) => m.status === "completed");

  const contributors = (people ?? []).filter((p) => p.role !== "user");

  const mine = open.filter((m) => m.assigned_to === profile?.id);
  // Decided once, when the missions first arrive: landing on an empty list is
  // worse than landing on a full one.
  const view = scope ?? "all";
  const shown = view === "mine" ? mine : open;

  const inProgress = shown.filter((m) => m.status === "in_progress");
  const suggested = shown.filter((m) => m.status === "suggested");

  /*
    The month's score, computed rather than promised: what got finished since
    the 1st, over that plus everything still open. Honest by construction —
    every number on the bar is a mission somebody can point at.
  */
  const now = new Date();
  const doneThisMonth = doneRows.filter((m) => {
    if (!m.completed_at) return false;
    const d = new Date(m.completed_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const monthTotal = doneThisMonth + open.length;

  /** No task kind and no channel: nothing Recall can watch for. */
  const freeForm = (m: Mission) =>
    m.origin === "human" && !m.channel_id && (!m.task_kind || m.task_kind === "custom");

  /** The two mono chips every card keeps, so "done" stays objective. */
  const chips = (mission: Mission, cream = false) => {
    const style = cream ? CHIP_STYLE_CREAM : CHIP_STYLE;
    const channelChip = mission.channel
      ? `CHANNEL ${String(mission.channel.number).padStart(2, "0")} · ${mission.channel.title}`
      : mission.task_kind === "record"
        ? "NEW CHANNEL · voice"
        : mission.task_kind === "add_photos"
          ? "NEW CHANNEL · photos"
          : null;
    if (!channelChip && !mission.task_kind && !cream) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {channelChip && (
          <span className={CHIP} style={style}>
            {channelChip}
          </span>
        )}
        {!cream && mission.task_kind && (
          <span className={CHIP} style={style}>
            {TASK_LABEL[mission.task_kind]?.(mission) ?? "TASK"}
          </span>
        )}
        {cream && mission.completed_at && (
          <span className={CHIP} style={style}>
            DONE · {doneAgo(mission.completed_at)}
          </span>
        )}
      </div>
    );
  };

  /** An open mission's card — orange-bordered while it is being worked. */
  const openCard = (mission: Mission) => {
    const active = mission.status === "in_progress";
    const liveCount =
      mission.task_kind === "describe_photos" && mission.channel_id
        ? (channels ?? []).find((c) => c.id === mission.channel_id)?.undescribed_count
        : null;

    return (
      <div
        key={mission.id}
        ref={(el) => {
          if (el) cardRefs.current.set(mission.id, el);
          else cardRefs.current.delete(mission.id);
        }}
        className="box-border flex flex-col gap-3.5 rounded-[22px] px-[22px] py-5"
        style={{
          background: "rgba(var(--ink),.045)",
          border: active ? "1.5px solid rgba(var(--accent-channels),.65)" : "1px solid rgba(var(--ink),.09)",
          boxShadow: focusId === mission.id ? "0 0 0 2px var(--accent)" : undefined,
        }}
      >
        <p className="text-[17px] font-medium leading-[1.35]" style={{ color: "var(--cream)" }}>
          {mission.title}
        </p>
        {(mission.detail || (liveCount != null && liveCount > 0)) && (
          <p className="text-[13px] leading-[1.55]" style={{ color: "rgba(var(--ink-cream),.65)" }}>
            {liveCount != null && liveCount > 0
              ? `${liveCount} photo${liveCount === 1 ? "" : "s"} have no description yet.`
              : mission.detail}
          </p>
        )}

        {chips(mission)}

        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={mission.assignee?.name ?? "?"} size={28} />
          <span className="text-[13px]" style={{ color: "var(--cream)" }}>
            {mission.assignee?.name ?? "Unassigned"}{" "}
            <span style={{ color: "var(--fg-quiet)" }}>
              {/* The frame folds origin into this line: "· suggested by Recall". */}
              {mission.assignee
                ? active
                  ? "· in progress"
                  : mission.origin === "recall"
                    ? "· suggested by Recall"
                    : "· suggested"
                : mission.origin === "recall"
                  ? "· suggested by Recall"
                  : ""}
              {mission.assigner &&
              mission.assignee &&
              mission.assigner.id !== mission.assignee.id
                ? ` · assigned by ${mission.assigner.name}`
                : ""}
            </span>
          </span>
          {isAdmin &&
            (changing === mission.id ? (
              <div className="ml-auto w-44">
                <Select
                  value={mission.assignee?.name ?? ""}
                  source={peopleSource}
                  what="The contributors"
                  options={["Nobody", ...contributors.map((p) => p.name)]}
                  onChange={(name) => {
                    // "Nobody" hands the mission back to the board.
                    if (name === "Nobody") {
                      update.mutate({ id: mission.id, body: { assigned_to: null } });
                      setChanging(null);
                      return;
                    }
                    const person = contributors.find((p) => p.name === name);
                    if (person) {
                      update.mutate({ id: mission.id, body: { assigned_to: person.id } });
                    }
                    setChanging(null);
                  }}
                />

              </div>
            ) : (
              <button
                type="button"
                onClick={() => setChanging(mission.id)}
                className="pressable ml-auto rounded-md px-2 py-1 text-xs"
                style={{ color: "var(--fg-hint)" }}
              >
                Change
              </button>
            ))}
        </div>

        <div
          className="flex items-center gap-4 pt-3.5"
          style={{ borderTop: "1px dashed rgba(var(--ink),.14)" }}
        >
          <button
            type="button"
            onClick={() => launch(mission)}
            className="pressable flex h-[42px] flex-1 items-center justify-center rounded-full text-[13px] font-medium"
            style={
              active
                ? { background: "var(--chip-on)", color: "var(--on-chip-on)" }
                : { border: "1px solid rgba(var(--ink),.18)", color: "rgba(var(--ink-cream),.9)" }
            }
          >
            {active ? "Continue mission" : "Start mission"}
          </button>
          {/*
            The one place a "Done" button is honest.

            Every other mission concludes on the save it asked for — a
            description written, a channel created, a card linked. A free-form
            task has no such save to speak for it, so somebody has to say when
            it happened: whoever it was given to, whoever wrote it, or an
            admin.
          */}
          {freeForm(mission) && (
            <button
              type="button"
              onClick={() => update.mutate({ id: mission.id, body: { status: "completed" } })}
              className="pressable rounded-md px-2 py-1 text-[13px]"
              style={{ color: "var(--fg-hint)" }}
            >
              Mark done
            </button>
          )}
          {isAdmin &&
            /*
              Dismiss asks first (M96).

              A Recall-generated mission grows back, but a human one is
              somebody's request and there is no way to restore it — so a
              mis-tap here loses a thing a person asked for. Same inline shape
              the editor uses for Archive: the button becomes a question, and
              only the second tap acts.
            */
            (confirmDismiss === mission.id ? (
              <span className="flex items-center gap-3 text-[13px]">
                <span className="text-fg-muted">Dismiss?</span>
                <button
                  type="button"
                  onClick={() => setConfirmDismiss(null)}
                  className="font-mono text-xs text-fg-faint hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    remove.mutate(mission.id);
                    setConfirmDismiss(null);
                  }}
                  style={{ color: "var(--destructive-soft)" }}
                >
                  Dismiss
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDismiss(mission.id)}
                className="pressable rounded-md px-2 py-1 text-[13px] text-fg-faint"
              >
                Dismiss
              </button>
            ))}
        </div>
      </div>
    );
  };

  return (
    <PageFrame
      header={
        <>
          <PageHeader
            title="Missions"
            /*
              "· 0 done this month" is a claim about what the family got
              through, and it came from a list that had not loaded (M202).
              The body of this page already consults `missionsState`; the
              header did not, which is the same half-fix as Insights and the
              Memory Shelf. The figure is the part a person reads.
            */
            subtitle={
              <>
                Small, finishable tasks that keep the archive alive
                {missionsState !== "loading" && missionsState !== "error" && (
                  <> · {doneThisMonth} done this month</>
                )}
              </>
            }
            actions={
              <div className="flex items-end gap-3.5">
                {monthTotal > 0 && (
                  <div className="w-[270px]">
                    <div
                      className="px-1 pb-2 font-mono text-[9px] tracking-[0.14em]"
                      style={{ color: "var(--fg-soft)" }}
                    >
                      THIS MONTH
                    </div>
                    <div
                      className="relative box-border h-[41px] overflow-hidden rounded-full"
                      style={{
                        border: "1px solid rgba(var(--ink),.13)",
                        backgroundImage:
                          "repeating-linear-gradient(115deg, rgba(var(--ink),.09) 0 2px, transparent 2px 8px)",
                      }}
                    >
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${Math.round((doneThisMonth / monthTotal) * 100)}%`,
                          background: "rgba(var(--accent-channels),.28)",
                        }}
                      />
                      <span
                        className="absolute left-5 top-1/2 -translate-y-1/2 text-[13px] font-medium leading-none"
                        style={{ color: "var(--cream)" }}
                      >
                        {doneThisMonth} of {monthTotal} done
                      </span>
                    </div>
                  </div>
                )}
                <PrimaryPill onClick={() => setAdding((v) => !v)}>
                  {adding ? "Cancel" : "+ New mission"}
                </PrimaryPill>
              </div>
            }
          />

          {/*
            The scope chips and the column labels live in the band, not in the
            scroller (M121, superseding M112's sticky approach).

            F29 wanted the labels to hold still while cards pass beneath them.
            Stickiness would have done that too, but position:sticky inside a
            clipping scroll region is a standing argument with its parent's
            overflow — it only holds while nothing above it changes. Relocation
            makes it structural: the band is already fixed by M114, so labels
            put there cannot move, and there is no scroll interaction left to
            get wrong.

            The label row mirrors the grid beneath it exactly — same columns,
            same gap, same `pr-1` for the scrollbar gutter — because the whole
            point is that a label sits over its own column.
          */}
          {rows.length > 0 && (
            <>
              <div className="flex flex-none items-center gap-2">
                {(
                  [
                    ["all", "All open", open.length],
                    ["mine", "My missions", mine.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScope(key)}
                    className="pressable rounded-full px-3.5 py-1.5 font-mono text-[11px] tracking-[0.1em]"
                    style={
                      view === key
                        ? { background: "rgba(var(--accent-channels),.16)", color: "var(--accent-on-tint)" }
                        : { border: "1px solid rgba(var(--ink),.16)", color: "var(--fg-muted)" }
                    }
                  >
                    {label.toUpperCase()} · {count}
                  </button>
                ))}
              </div>

              {/*
                `ring-room` as well as `pr-1`: the scroller below carries both,
                and its 3px of padding narrows the columns it lays out. Without
                it the labels drifted 1-2px off their columns by the third one —
                invisible alone, wrong the moment you look down a column edge.
              */}
              <div className="ring-room hidden flex-none grid-cols-3 gap-4 pr-1 md:grid">
                <div className={`${CAPS} px-1`} style={{ color: "var(--accent-soft)" }}>
                  IN PROGRESS · {inProgress.length}
                </div>
                <div className={`${CAPS} px-1`} style={{ color: "var(--fg-hint)" }}>
                  SUGGESTED · {suggested.length}
                </div>
                <div className={`${CAPS} px-1`} style={{ color: "var(--fg-hint)" }}>
                  DONE · {doneRows.length}
                </div>
              </div>
            </>
          )}

          <p
            role="alert"
            className="-my-3 h-5 flex-none text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>
        </>
      }
    >
      {adding && (
        <div
          className="box-border grid flex-none gap-3 rounded-[22px] p-5 md:grid-cols-[2fr_1fr_1fr_1fr_auto]"
          style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
        >
          <label>
            <span className={`${LABEL} text-fg-muted`}>WHAT NEEDS DOING</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                // Steer toward something concludable — until they overrule it.
                if (!taskChosenByHand) {
                  const guess = guessTaskFromTitle(e.target.value);
                  if (guess) setTaskChoice(guess);
                }
              }}
              placeholder="Record a message from Luc"
              className="mt-2 h-[50px] w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent"
              style={{ borderColor: "rgba(var(--ink),.22)" }}
            />
          </label>
          <div>
            <span className={`${LABEL} text-fg-muted`}>TASK</span>
            <Select
              value={taskChoice}
              options={TASK_CHOICES.map((c) => c.label)}
              onChange={(v) => {
                setTaskChoice(v);
                setTaskChosenByHand(true);
              }}
            />
          </div>
          <div>
            <span className={`${LABEL} text-fg-muted`}>
              CHANNEL{chosen.needsChannel ? " *" : ""}
            </span>
            <Select
              value={targetChannel}
              source={channelSource}
              what="The memories"
              options={(channels ?? []).map(
                (c) => `${String(c.number).padStart(2, "0")} · ${c.title}`
              )}
              onChange={setTargetChannel}
              placeholder={chosen.needsChannel ? "Choose one" : "None"}
            />
          </div>
          <div>
            <span className={`${LABEL} text-fg-muted`}>ASSIGN TO</span>
            <Select
              value={assignee}
              source={peopleSource}
              what="The contributors"
              options={contributors.map((p) => p.name)}
              onChange={setAssignee}
              placeholder="Nobody yet"
            />
          </div>
          <div className="self-end">
            <PrimaryPill
              disabled={!title.trim() || channelMissing || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Saving…" : "Save"}
            </PrimaryPill>
          </div>
        </div>
      )}

      {missionsState === "loading" && (
        <p style={{ color: "var(--fg-soft)" }}>Loading…</p>
      )}

      {/*
        A failed load used to reach the line below and announce that the
        family has nothing to do (M181, F70) — and the three columns beneath
        it would each say "nothing" as well, so the page agreed with itself
        four times about a list it never received.
      */}
      {missionsState === "error" && (
        <p className="mt-10 text-center" style={{ color: "var(--fg-soft)" }}>
          The missions could not be loaded, so we cannot say what is outstanding.
        </p>
      )}

      {missionsState === "empty" && (
        <p className="mt-10 text-center" style={{ color: "var(--fg-soft)" }}>
          No missions yet. Create one to guide the family.
        </p>
      )}

      {rows.length > 0 && (
        <>
          {/*
            The three headings stay put and the cards scroll under them, which
            is the point (owner). What was wrong is the foot: `pb-2` left eight
            pixels under the last card, so the bottom one always looked sliced
            by the edge of the box rather than ended. The pad is now deep
            enough that the final card scrolls clear of the frame and the list
            visibly runs out instead of being cut off.
          */}
          <div className="scroll-thin ring-room grid min-h-0 flex-1 grid-cols-1 items-start gap-4 overflow-y-auto pb-16 pr-1 md:grid-cols-3">
            {/* ── In progress ── */}
            <div className="flex flex-col gap-3">
              {inProgress.map(openCard)}
              {inProgress.length === 0 && (
                <p className="px-1 text-sm text-fg-faint">Nothing underway just now.</p>
              )}
            </div>

            {/* ── Suggested ── */}
            <div className="flex flex-col gap-3">
              {suggested.map(openCard)}
              {suggested.length === 0 && (
                <p className="px-1 text-sm text-fg-faint">
                  {view === "mine"
                    ? "Nothing assigned to you just now."
                    : "Nothing to do — the archive rests."}
                </p>
              )}
            </div>

            {/* ── Done: celebrates in cream, and reports what it changed ── */}
            <div className="flex flex-col gap-3">
              {doneRows.map((mission) => (
                <div
                  key={mission.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(mission.id, el);
                    else cardRefs.current.delete(mission.id);
                  }}
                  className="panel-inverted box-border flex flex-col gap-3.5 rounded-[22px] px-[22px] py-5"
                  style={{
                    background: "var(--panel-pale)",
                    color: "var(--on-cream)",
                    boxShadow:
                      focusId === mission.id ? "0 0 0 2px var(--accent)" : undefined,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <MissionMark state="done" size={30} />
                    <span className="text-[17px] font-medium leading-[1.3]" style={{ color: "var(--on-panel-pale)" }}>
                      {mission.title}
                    </span>
                  </div>
                  {/* Always rendered: the line's height is part of the card's
                      shape, so a mission with nothing to say still stands as
                      tall as its neighbours. */}
                  <p
                    className="min-h-5 text-[13px] leading-[1.55]"
                    style={{ color: "rgba(var(--on-panel-channels),.6)" }}
                  >
                    {doneDetail(mission) ?? " "}
                  </p>
                  {chips(mission, true)}
                  <div
                    className="flex items-center gap-2.5 pt-3.5"
                    style={{ borderTop: "1px dashed rgba(var(--panel-wash-channels),.15)" }}
                  >
                    <span
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-medium"
                      style={{ background: "rgba(var(--panel-wash-channels),.08)", color: "var(--on-panel-pale)" }}
                    >
                      {(mission.assignee?.name ?? "?").charAt(0).toUpperCase()}
                    </span>
                    <span className="text-[13px]" style={{ color: "var(--on-panel-pale)" }}>
                      {mission.assignee ? `Completed by ${mission.assignee.name}` : "Completed"}
                    </span>
                    {mission.channel && (
                      <Link
                        to={`/admin/channels/${mission.channel.id}/edit`}
                        className="ml-auto text-[12px]"
                        style={{ color: "rgba(var(--on-panel-channels),.55)" }}
                      >
                        View channel →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
              {doneRows.length === 0 && (
                <p className="px-1 text-sm text-fg-faint">Nothing finished yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </PageFrame>
  );
}
