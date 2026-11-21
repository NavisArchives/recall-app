import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { listState } from "@/lib/listState";
import { useChannels, useMissions, useNfcCards, type NfcCard, type CardState } from "@/hooks/useAdminData";
import { cardPill, isUnfinished, PILL_STYLE } from "@/lib/cardState";
import { MissionBanner } from "@/components/admin/MissionBanner";
import { useDisplay } from "@/lib/DisplayContext";
import { PageFrame, PageHeader, PrimaryPill } from "@/components/admin/kit";

const LABEL = "font-mono text-[11px] tracking-[0.16em] text-fg-muted";

/** The frame's contactless mark: a dot and two arcs. */

/**
 * The physical half of Recall: the objects around the house that open a
 * memory when she touches them to the reader. A card's tag simply carries
 * the channel's number, so this page is a registry of which object means
 * what — and the one place to correct a card that opens the wrong memory.
 *
 * Frame 1e draws each card as a tile on the table: cream when it is linked
 * and working, orange-bordered while a channel is being chosen for it, and
 * dashed while it is still spare.
 */
/**
 * When a card arrived, in the words a person would use (18k).
 *
 * A weekday for the last week — "since Monday" is how somebody actually
 * says it — and a date once that stops meaning anything. "Since Tuesday"
 * three weeks later is worse than useless: it reads as recent.
 */
function arrivedWhen(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "recently";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export function CardsPage() {
  /*
   * Whose archive this is. "Margaret" was written into these sentences when
   * there was only ever one family; every other family read somebody else's
   * mother's name on their own screens. Falls back to a neutral word rather
   * than a wrong one.
   */
  const { subjectName } = useDisplay();
  const who = subjectName ?? "she";

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: cards, isPending, isError } = useNfcCards();
  /*
    The channel picker for linking a card (M219). Empty on a failed read, it
    says the archive has no memories to link — to somebody holding the card.
  */
  /*
    Kept for 18k's "no channels yet" state: a card needs a channel to open, so
    an archive with none is a different empty screen from an archive with no
    cards — it points at making a channel rather than making a card.
  */
  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const noChannelsYet = !channelsPending && !channelsFailed && (channels ?? []).length === 0;

  // ── Mission mode: "link a card to channel NN" ────────────────────────
  const missionId = (location.state as { missionId?: string } | null)?.missionId ?? null;
  const { data: allMissions } = useMissions();
  const mission = missionId
    ? (allMissions ?? []).find((m) => m.id === missionId && m.status !== "completed")
    : undefined;
  const missionMode = !!mission && mission.task_kind === "link_nfc";

  useEffect(() => {
    if (!missionMode) return;
    document.body.classList.add("mission-mode");
    const exit = () => navigate(location.pathname, { replace: true, state: {} });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };
    // A press outside the mission's own work ends the mission — the phone's
    // Escape. `click`, so a scroll-drag never counts as leaving.
    const press = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-mission-anchor], .mission-lift, .mission-next, .mission-target, [role='status']")) return;
      exit();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("click", press);
    return () => {
      document.body.classList.remove("mission-mode");
      document.removeEventListener("keydown", key);
      document.removeEventListener("click", press);
    };
  }, [missionMode, navigate, location.pathname]);

  /*
    Registering a tap card is the second choice inside the create flow now
    (18a has one button), so the flow sends you back here with this flag
    rather than the form living behind a competing button on the overview.
  */
  const openRegister = (location.state as { register?: boolean } | null)?.register === true;
  const [adding, setAdding] = useState(openRegister);
  const [label, setLabel] = useState("");
  const [object, setObject] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  // Which tile has its kebab menu open.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /*
    Which card is asking "are you sure?", and about what (M96).

    The question takes over the menu the press happened in, rather than
    appearing somewhere else on the tile. F36 caught the earlier shape: the
    confirm materialised at the tile's foot while the finger was at a
    top-right menu — two presses, no request, and a control that read as
    dead because its third press was standing in a place nobody looked.
    A confirm belongs where the press was.
  */
  const [confirm, setConfirm] = useState<{ id: string; act: "unlink" | "remove" } | null>(null);

  const closeMenus = () => {
    setMenuFor(null);
    setConfirm(null);
  };

  /*
    Escape retreats, wherever the focus went.

    The confirm replaces the button that was clicked, so focus is left on a
    node that no longer exists and a local `onKeyDown` would never fire. A
    window listener is what makes "press Escape to back out" true rather than
    merely intended.
  */
  useEffect(() => {
    if (!confirm && !linking && !menuFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLinking(null);
        closeMenus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, linking, menuFor]);

  // The menu — and the question inside it — closes when the press lands
  // anywhere else. Leaving is cancelling (M96): nothing changes.
  useEffect(() => {
    if (!menuFor) return;
    const onPress = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-card-menu]")) return;
      closeMenus();
    };
    document.addEventListener("click", onPress);
    return () => document.removeEventListener("click", onPress);
  }, [menuFor]);

  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
    void queryClient.invalidateQueries({ queryKey: ["suggestions"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post("/nfc-cards", { label: label.trim(), linked_object: object.trim() || null }),
    onSuccess: () => {
      setLabel("");
      setObject("");
      setAdding(false);
      setError(null);
      refresh();
    },
    onError: (err: Error) => setError(err.message),
  });

  const link = useMutation({
    mutationFn: ({ id, channel_id }: { id: string; channel_id: string | null }) =>
      api.patch(`/nfc-cards/${id}`, { channel_id }),
    onSuccess: async (_data, variables) => {
      setLinking(null);
      refresh();
      // The card the mission asked for: the mission is done the moment the
      // channel has one.
      if (missionMode && mission && variables.channel_id === mission.channel_id) {
        try {
          await api.patch(`/missions/${mission.id}`, { status: "completed" });
          await queryClient.invalidateQueries({ queryKey: ["missions"] });
        } catch {
          /* the link exists either way */
        }
        navigate("/admin/missions", { state: { focusId: mission.id } });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  /*
    Removal, the missing half of F36. The backend could always do this
    (DELETE /nfc-cards/:id); no control ever asked it to. A removed card is
    gone from the registry — the physical object stays on the shelf and
    simply opens nothing, which is why the question asks first.
  */

  /*
    18a's filter bar. Two independent axes, exactly as the frame draws them:
    a KIND on the left (All / Postcards / NFC cards) and a STATE beside it
    (Draft / Ready to send / Sent / Delivered), with a search over the words
    a family would actually remember — the card's own name and the channel it
    opens.

    Both are click-to-toggle rather than exclusive-select: a state chip stays
    usable while a kind is chosen, because "the postcards still waiting to go"
    is one question, not two.
  */
  const [kindFilter, setKindFilter] = useState<"all" | "postcard" | "nfc">("all");
  const [stateFilter, setStateFilter] = useState<CardState | null>(null);
  const [search, setSearch] = useState("");

  const allRows = cards ?? [];
  const rows = allRows.filter((c) => {
    if (kindFilter !== "all" && (c.kind ?? "nfc") !== kindFilter) return false;
    if (stateFilter && c.state !== stateFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.label ?? "").toLowerCase().includes(q) ||
      (c.channel?.title ?? "").toLowerCase().includes(q)
    );
  });
  const cardsState = listState({ isPending, isError, count: allRows.length });

  /** The channel picker both Link and Relink open inside a tile (M96: cancel + Escape). */

  /**
   * The card's actions, and the question they lead to, in one anchored spot.
   *
   * The confirm swaps into the open menu instead of appearing elsewhere on
   * the tile (F36): the second press lands exactly where the first one did.
   * Cancel, Escape, and clicking away all retreat with nothing changed (M96).
   */

  return (
    /* A roster, like Contributors — no control row over two cards. The
       register/order buttons stay where the owner wants them, at the
       title's right, and the grid deliberately gains no dashed add tile. */
    <PageFrame
      type="roster"
      header={
        <>
          {missionMode && mission && (
            <MissionBanner
              title={mission.title}
              instruction={`Press Link on a free card and choose "${mission.channel?.title ?? "the channel"}" — linking it finishes the mission.`}
              onExit={() => navigate(location.pathname, { replace: true, state: {} })}
            />
          )}
          {missionMode && <div className="mission-veil" aria-hidden="true" />}

          <PageHeader
            title="Cards"
            subtitle={
              <>
                Physical cards that give {who === "she" ? "her" : who} simple access to her
                channels.
                <br />
                Each one opens a channel — nothing on it is typed twice.
              </>
            }
            actions={
              /*
                One action, as 18a draws it. The old pair — "Order more cards"
                (a placeholder with nothing behind it) and "+ Register a card"
                — became one door: registering a tag is now the second choice
                INSIDE the flow rather than a competing button out here, so
                the overview asks one question instead of three.

                The linked count that used to sit in the subtitle is gone with
                them. M202 put it there to stop a fabricated figure appearing
                on a failed read; the frame does not have it at all, and a
                number that is not shown cannot be wrong.
              */
              <div className="flex flex-wrap items-center gap-2">
                {/* The monthly ritual (18i) lives beside the one-off send
                    rather than inside it: setting up a repeat and posting a
                    card today are two different intentions, and burying one
                    inside the other's flow makes the quieter one invisible. */}
                <button
                  type="button"
                  onClick={() => navigate("/admin/cards/schedule")}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
                  style={{ border: "1px solid var(--line-soft)", color: "var(--fg-muted)" }}
                >
                  Send every month
                </button>
                <PrimaryPill onClick={() => navigate("/admin/cards/new")}>+ Create card</PrimaryPill>
              </div>
            }
          />

          {/* ── 18a's filter bar ─────────────────────────────────────── */}
          <div className="flex flex-none flex-wrap items-center gap-2">
            {([
              ["all", "All"],
              ["postcard", "Postcards"],
              ["nfc", "Connected cards"],
            ] as const).map(([value, label]) => {
              const on = kindFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKindFilter(value)}
                  className="min-h-[44px] sm:min-h-0 rounded-full px-[15px] py-2 text-[12.5px] leading-none"
                  style={
                    on
                      ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                      : { border: "1px solid rgba(var(--ink),.12)", color: "rgba(var(--ink),.7)" }
                  }
                  aria-pressed={on}
                >
                  {label}
                </button>
              );
            })}

            <span className="mx-1 h-4 w-px" style={{ background: "rgba(var(--ink),.14)" }} aria-hidden />

            {([
              ["draft", "Draft"],
              ["ready", "Ready to send"],
              ["sent", "Sent"],
              ["delivered", "Delivered"],
            ] as const).map(([value, label]) => {
              const on = stateFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  /* Click the chip you are on to clear it — the family's way
                     back to "everything" without hunting for All. */
                  onClick={() => setStateFilter(on ? null : value)}
                  className="min-h-[44px] sm:min-h-0 rounded-full px-3 py-[7px] font-mono text-[11.5px] leading-none"
                  style={{
                    letterSpacing: ".06em",
                    color: on ? "var(--fg)" : "var(--fgw-hint)",
                    border: `1px solid ${on ? "rgba(var(--ink),.28)" : "transparent"}`,
                  }}
                  aria-pressed={on}
                >
                  {label}
                </button>
              );
            })}

            <label className="w-full sm:ml-auto sm:w-auto">
              <span className="sr-only">Search cards</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cards"
                className="min-h-[44px] sm:min-h-0 w-full rounded-full sm:w-[220px] bg-transparent px-4 py-2 text-[12.5px] outline-none focus:border-accent"
                style={{ border: "1px solid rgba(var(--ink),.12)", color: "var(--fg)" }}
              />
            </label>
          </div>

          {/* One line of feedback, always reserved so the grid never jumps. */}
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) create.mutate();
          }}
          className="box-border flex flex-none flex-wrap items-end gap-3 rounded-[22px] p-5"
          style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
        >
          <label className="flex-1">
            <span className={LABEL}>CARD NAME</span>
            <input
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Seashell from the beach"
              className="mt-1.5 w-full rounded-[10px] bg-[rgba(var(--ink),0.04)] px-4 py-2.5 outline-none focus:border-accent"
              style={{ border: "1px solid var(--input)" }}
            />
          </label>
          <label className="flex-1">
            <span className={LABEL}>WHAT IS THE OBJECT?</span>
            <input
              value={object}
              onChange={(e) => setObject(e.target.value)}
              placeholder="The frame on her bedside table"
              className="mt-1.5 w-full rounded-[10px] bg-[rgba(var(--ink),0.04)] px-4 py-2.5 outline-none focus:border-accent"
              style={{ border: "1px solid var(--input)" }}
            />
          </label>
          <PrimaryPill type="submit" disabled={!label.trim() || create.isPending}>
            {create.isPending ? "Saving…" : "Save"}
          </PrimaryPill>
        </form>
      )}

      {/*
        The same false-empty as the undo door, and the same fix (M180, F70).
        "No NFC cards registered yet." on a failed load tells an admin that
        the cards do not exist — so an admin who has just removed one could
        read it as having lost them all, or register a card that is already
        registered. `listState` cannot reach "empty" from a failure.
      */}
      {/*
        18k. Each state teaches something rather than reporting a count.

        The two failures both promise the same two things in their first
        breath — what did not happen, and that nothing was lost — because that
        is the order a worried person needs them in.
      */}
      {cardsState === "loading" && (
        /* Skeletons hold each row's height, so nothing jumps when the cards
           arrive (18k). A spinner would move the page twice. */
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[18px]"
              style={{ height: 208, background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.08)" }}
            />
          ))}
        </div>
      )}

      {cardsState === "error" && (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <p className="font-mono text-[11px] tracking-[0.16em]" style={{ color: "var(--destructive-soft)" }}>
            SOMETHING FAILED
          </p>
          <p className="text-[17px]">The cards could not be loaded.</p>
          <p className="max-w-[46ch] text-[14px] text-fg-faint">
            Nothing has been lost — this is only the list. Everything you have made is still here.
          </p>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["nfc-cards"] })}
            className="min-h-[44px] sm:min-h-0 mt-1 rounded-full px-5 py-2.5 text-[13px]"
            style={{ border: "1px solid rgba(var(--ink),.16)" }}
          >
            Try again
          </button>
        </div>
      )}

      {cardsState === "empty" &&
        (noChannelsYet ? (
          /* A card needs a channel to open, so this archive is one step
             further back than "no cards" — and pointing at Create card would
             walk them into a dead end. */
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="label-caps">No channels yet</p>
            <p className="text-[17px]">A card needs a channel to open.</p>
            <p className="max-w-[52ch] text-[14px] text-fg-faint">
              {who === "she" ? "She" : who} has no channels yet — make one first, then the card
              takes everything from it.
            </p>
            <button
              type="button"
              onClick={() => navigate("/admin/create-channel")}
              className="min-h-[44px] sm:min-h-0 mt-1 rounded-full px-5 py-2.5 text-[13px]"
              style={{ border: "1px solid rgba(var(--ink),.16)" }}
            >
              Create a channel
            </button>
          </div>
        ) : (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <p className="label-caps">No cards yet</p>
            {/* The empty state teaches the concept in one line. */}
            <p className="text-[17px]">A card is a doorway into a channel.</p>
            <p className="max-w-[52ch] text-[14px] text-fg-faint">
              Pick one and the front and back are prepared for you — nothing to design.
            </p>
            <PrimaryPill onClick={() => navigate("/admin/cards/new")}>+ Create card</PrimaryPill>
          </div>
        ))}

      {/*
        18a draws a grid of equal tiles, and the fixed row keeps that true when
        a short NFC card sits beside a postcard with four lines of detail —
        ragged tile heights across three columns look like a rendering fault.

        In ONE column there is nothing to line up with, and the same rule turns
        into ~90px of empty tile above every "View" (18l). So the height is a
        multi-column rule, applied where multiple columns exist.
      */}
      <div className="scroll-thin ring-room grid min-h-0 flex-1 auto-rows-max content-start grid-cols-1 gap-3.5 overflow-y-auto pb-2 pr-1 md:auto-rows-[262px] md:grid-cols-2 xl:grid-cols-3">
        {rows.map((card: NfcCard) => {
          const pill = cardPill(card);
          const n = card.channel?.number;
          const number = typeof n === "number" ? String(n).padStart(2, "0") : "--";
          const unfinished = isUnfinished(card);
          const kindWord = card.kind === "postcard" ? "Postcard" : "Connected card";
          const when = card.sent_at ?? card.created_at;

          return (
            <button
              key={card.id}
              type="button"
              onClick={() =>
                navigate(unfinished ? "/admin/cards/new" : `/admin/cards/${card.id}`)
              }
              className="pressable flex flex-col items-start rounded-[18px] p-5 text-left"
              style={{ border: "1px solid rgba(var(--ink),.12)", background: "rgba(var(--ink),.03)" }}
            >
              {/*
                The number is the biggest text on the tile — the brief's bridge
                principle. It is what is printed on the card in her hand and
                what she types on the keypad, so it is the one thing that has
                to be the same size in both places.
              */}
              <div className="flex w-full items-baseline gap-3">
                <span className="font-mono text-[34px] leading-none" style={{ color: "var(--fg)" }}>
                  {number}
                </span>
                <span className="min-w-0 flex-1 truncate text-[17px]">
                  {card.channel?.title ?? card.label}
                </span>
                <span
                  className="flex-none rounded-full px-2.5 py-1 text-[11px] leading-none"
                  style={PILL_STYLE[pill.tone]}
                >
                  {pill.label}
                </span>
              </div>

              {/* Card and channel must never read as separate things (18a). */}
              <p
                className="mt-4 font-mono text-[10.5px] uppercase"
                style={{ letterSpacing: ".12em", color: "var(--accent-soft)" }}
              >
                {card.channel
                  ? `Opens channel ${number} · ${card.channel.title}`
                  : "Not linked to a channel yet"}
              </p>

              <p className="mt-2 text-[13px] text-fg-muted">
                {kindWord}
                {card.recipient?.name ? ` · To ${card.recipient.name}` : ""}
              </p>
              <p className="mt-0.5 text-[13px] text-fg-faint">
                {card.sender?.name ? `From ${card.sender.name} · ` : ""}
                {new Date(when).toLocaleDateString("en-GB", { dateStyle: "long" })}
              </p>

              {/*
                18k's DELIVERED: "the detail page keeps the timeline; the
                overview just says it arrived." So this is one warm sentence
                and no progress — a family scanning the list wants to know it
                got there, and a five-stop timeline repeated on every tile
                would bury that under machinery.
              */}
              {card.state === "delivered" && card.delivered_at && (
                <p className="mt-2 text-[13px]" style={{ color: "var(--accent-soft)" }}>
                  With {card.recipient?.name?.split(" ")[0] ?? "her"} since{" "}
                  {arrivedWhen(card.delivered_at)}.
                </p>
              )}

              {/*
                18a's tile carries no menu — the actions live on the detail
                page. The one exception is mission mode, where the whole point
                of being here is to bind THIS card to the channel the mission
                names, and completing the mission is what that binding does.
              */}
              {missionMode && mission && !card.channel_id ? (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    link.mutate({ id: card.id, channel_id: mission.channel_id });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      link.mutate({ id: card.id, channel_id: mission.channel_id });
                    }
                  }}
                  className="mt-4 inline-flex min-h-8 items-center self-start rounded-full px-3.5 py-1.5 text-[12.5px] font-medium leading-tight"
                  style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
                >
                  {linking === card.id ? "Linking…" : "Link this card to the mission's channel"}
                </span>
              ) : (
                /* Bottom-RIGHT (owner-directed): the reading eye finishes a
                   tile at its lower right, so the action waits where the
                   reading ends instead of making the eye travel back. */
                /* A quiet pill, not an underlined word (owner, 21 Sep 2026:
                   "the view button looks a bit old school"). */
                <span
                  className="ml-auto mt-4 inline-flex h-8 items-center rounded-full border px-3.5 text-[12.5px] font-medium"
                  style={{ borderColor: "rgba(var(--ink),.22)" }}
                >
                  {unfinished ? "Continue" : "View"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </PageFrame>
  );
}
