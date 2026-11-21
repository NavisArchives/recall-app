import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useChannels, useMissions, usePeople, type Mission } from "@/hooks/useAdminData";
import { missionDestination } from "@/components/admin/MissionBanner";
import { Select } from "@/components/admin/Select";
import { Sheet, SheetCancel } from "@/mobile/Sheet";
import { SwipeToDismiss } from "@/mobile/SwipeToDismiss";

/**
 * Missions on a phone — one list, not the desktop board in a box (M60).
 *
 * The board is a fixed-height, two-column workspace with its own inner
 * scrollers. Rendered inside a scrolling phone page, all of that fights
 * itself: the open column collapsed to the height of a single card and
 * trapped its own scrollbar, so ten missions were one mission, and the page
 * around it had no gutters because it had always inherited them from the
 * desktop layout. "+ New mission" ran off the right edge — a primary action
 * you could not finish pressing.
 *
 * Everything here is the opposite choice: the page flows, the shell scrolls
 * it, nothing nests, and the form is a sheet because that is where a thumb
 * already is.
 */

const TASK_CHOICES: { label: string; kind: Mission["task_kind"]; needsChannel: boolean }[] = [
  { label: "Describe photos", kind: "describe_photos", needsChannel: true },
  { label: "Add photos", kind: "add_photos", needsChannel: false },
  { label: "Record a message", kind: "record", needsChannel: false },
  { label: "Create a channel", kind: "create_channel", needsChannel: false },
  { label: "Link a card", kind: "link_nfc", needsChannel: true },
  { label: "Custom task", kind: "custom", needsChannel: false },
];

function MissionCard({
  mission,
  assigneeName,
  onStart,
}: {
  mission: Mission;
  assigneeName: string | null;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="w-full rounded-[16px] border border-line-soft p-4 text-left"
    >
      <span className="block text-[15px] font-medium leading-[1.35]">{mission.title}</span>

      <span className="mt-2.5 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-mono text-[10px] tracking-[0.14em] text-fg-faint">
          {mission.status === "in_progress" ? "IN PROGRESS" : "OPEN"}
          {assigneeName ? ` · ${assigneeName.split(" ")[0].toUpperCase()}` : ""}
        </span>
        {/* A real pill, not a bare arrow (owner, 21 Sep 2026: "just an
            arrow looks very old school"). A span, because the card is
            already the button. */}
        <span
          className="inline-flex h-8 flex-none items-center gap-1 rounded-full pl-3.5 pr-2.5 text-[12.5px] font-medium"
          style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          Start
          <ChevronRight size={14} strokeWidth={2} aria-hidden />
        </span>
      </span>
    </button>
  );
}

export function MobileMissions() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, profile } = useAuth();
  /*
    The phone fork of the missions list (M202's class, found by /dev/pages).

    Its desktop twin already reads `listState`; this one took `isLoading`
    only, so a failed load rendered "All open · 0 · Mine · 0" and
    "Recall will suggest things here as the archive grows." — a count and a
    reassurance, both invented, on a request that never answered. `isLoading`
    is also false for a query parked between retries (M191), so it said the
    same thing while still waiting.
  */
  const { data: missions, isPending: isLoading, isError: missionsFailed } = useMissions();
  /*
    Both lists feed pickers, and a picker that comes back empty reads as
    "the archive has none of these" (M219). Their own states, because they
    are two requests and one failing says nothing about the other.
  */
  const { data: people, isPending: peoplePending, isError: peopleFailed } = usePeople();
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const peopleSource = peoplePending ? "loading" : peopleFailed ? "failed" : "ready";
  const channelSource = channelsPending ? "loading" : channelsFailed ? "failed" : "ready";

  const [scope, setScope] = useState<"mine" | "all" | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [taskChoice, setTaskChoice] = useState("Custom task");
  const [assignee, setAssignee] = useState("");
  const [targetChannel, setTargetChannel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["missions"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  const chosen = TASK_CHOICES.find((c) => c.label === taskChoice) ?? TASK_CHOICES[5];
  const chosenChannel = (channels ?? []).find(
    (c) => `${String(c.number).padStart(2, "0")} · ${c.title}` === targetChannel
  );
  const channelMissing = chosen.needsChannel && !chosenChannel;

  const create = useMutation({
    mutationFn: () =>
      api.post("/missions", {
        title: title.trim(),
        detail: null,
        status: assignee ? "in_progress" : "suggested",
        assigned_to: (people ?? []).find((p) => p.name === assignee)?.id ?? null,
        channel_id: chosen.kind === "create_channel" ? null : (chosenChannel?.id ?? null),
        task_kind: chosen.kind === "custom" && !chosenChannel ? null : chosen.kind,
        task_count:
          chosen.kind === "describe_photos" ? (chosenChannel?.undescribed_count ?? null) : null,
      }),
    onSuccess: () => {
      setTitle("");
      setTaskChoice("Custom task");
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
  });

  // The same action the desktop card got in M96 — the phone reaches it by
  // swipe rather than by an inline confirm (M98).
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/missions/${id}`),
    onSuccess: refresh,
  });

  function launch(mission: Mission) {
    if (mission.status === "suggested") {
      update.mutate({ id: mission.id, body: { status: "in_progress" } });
    }
    const destination = missionDestination(mission);
    if (destination) navigate(destination.path, { state: destination.state });
  }

  const rows = missions ?? [];
  const rank = (m: Mission) => (m.status === "in_progress" ? 0 : m.origin === "human" ? 1 : 2);
  const open = rows.filter((m) => m.status !== "completed").sort((a, b) => rank(a) - rank(b));
  const done = rows.filter((m) => m.status === "completed");

  const mine = open.filter((m) => m.assigned_to === profile?.id);
  // M54's rule, unchanged: your own work first, unless you have none — an
  // empty page is a worse greeting than the family's list.
  // The family's list leads on the phone too, so the two boards agree.
  const view = scope ?? "all";
  const shown = view === "mine" ? mine : open;

  const nameOf = (id: string | null) =>
    id ? ((people ?? []).find((p) => p.id === id)?.name ?? null) : null;

  return (
    // The shell frames this page (M75); it carries content only.
    <div>
      <div className="flex items-baseline justify-between gap-3 pb-4 pt-2">
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">Missions</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex-none rounded-full px-4 py-2 text-[13px] font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            + New
          </button>
        )}
      </div>

      {/* Two chips, always both, so the count is visible before you choose. */}
      <div className="flex gap-2 pb-4">
        {(
          [
            // The count waits until there is something to count.
            ["all", isLoading || missionsFailed ? "All open" : `All open · ${open.length}`],
            ["mine", isLoading || missionsFailed ? "Mine" : `Mine · ${mine.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setScope(key)}
            className="min-h-[36px] rounded-full px-3.5 text-[13px]"
            style={
              view === key
                ? { background: "var(--accent)", color: "#fff", fontWeight: 500 }
                : { border: "1px solid var(--line)", color: "var(--fg-muted)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading && <p className="py-10 text-center text-sm text-fg-muted">Loading…</p>}

      {/* One flowing list. No inner scroller anywhere on this page. */}
      <div className="flex flex-col gap-3">
        {shown.map((m) => {
          const card = (
            <MissionCard
              mission={m}
              assigneeName={nameOf(m.assigned_to)}
              onStart={() => launch(m)}
            />
          );
          // Dismissing is an admin's act on either surface; a co-author sees
          // the card exactly as before, with no gesture attached to it.
          return isAdmin ? (
            <SwipeToDismiss key={m.id} onDismiss={() => remove.mutate(m.id)}>
              {card}
            </SwipeToDismiss>
          ) : (
            <div key={m.id}>{card}</div>
          );
        })}
      </div>

      {missionsFailed && !isLoading && (
        <p className="py-10 text-center text-sm leading-[1.6] text-fg-muted">
          The missions could not be loaded, so we cannot say what is waiting.
        </p>
      )}

      {!isLoading && !missionsFailed && shown.length === 0 && (
        <p className="py-10 text-center text-sm leading-[1.6] text-fg-muted">
          {view === "mine"
            ? "Nothing is assigned to you right now."
            : "Recall will suggest things here as the archive grows."}
        </p>
      )}

      {done.length > 0 && (
        <>
          <p className="pb-3 pt-8 font-mono text-[10px] tracking-[0.16em] text-fg-faint">
            DONE — {done.length}
          </p>
          <div className="flex flex-col gap-2">
            {done.slice(0, 20).map((m) => (
              <div
                key={m.id}
                className="rounded-[14px] border border-line-soft px-4 py-3 opacity-60"
              >
                <span className="block truncate text-[13px]">{m.title}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)}>
        <p className="pb-4 text-[17px] font-semibold">New mission</p>

        <div className="flex flex-col gap-4">
          {/* One field per row: a phone has one column and pretending
              otherwise is what the desktop grid did here. */}
          <label className="block">
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">WHAT</span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Describe the photos in Sunday lunches"
              className="mt-2 h-[50px] w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent"
              style={{ borderColor: "rgba(var(--ink),.22)" }}
            />
          </label>

          <div>
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">KIND</span>
            <Select
              value={taskChoice}
              options={TASK_CHOICES.map((c) => c.label)}
              onChange={setTaskChoice}
            />
          </div>

          {chosen.needsChannel && (
            <div>
              <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">CHANNEL</span>
              <Select
                value={targetChannel}
                source={channelSource}
                what="The memories"
                options={(channels ?? []).map(
                  (c) => `${String(c.number).padStart(2, "0")} · ${c.title}`
                )}
                onChange={setTargetChannel}
                placeholder="Choose…"
              />
            </div>
          )}

          <div>
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
              WHO (OPTIONAL)
            </span>
            <Select
              value={assignee}
              source={peopleSource}
              what="The contributors"
              options={(people ?? []).filter((p) => p.role !== "user").map((p) => p.name)}
              onChange={setAssignee}
              placeholder="Anyone"
            />
          </div>

          <p
            role="alert"
            className="h-5 text-sm text-destructive-soft"
            style={{ visibility: error ? "visible" : "hidden" }}
          >
            {error || " "}
          </p>

          <button
            type="button"
            disabled={!title.trim() || channelMissing || create.isPending}
            onClick={() => create.mutate()}
            className="h-[50px] w-full rounded-[12px] text-[15px] font-medium text-white disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            {create.isPending ? "Saving…" : "Save"}
          </button>

          <SheetCancel onClose={() => setAdding(false)} />
        </div>
      </Sheet>
    </div>
  );
}
