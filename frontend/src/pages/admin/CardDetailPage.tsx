import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useNfcCards, type NfcCard } from "@/hooks/useAdminData";
import { useAuth } from "@/context/AuthContext";
import { useDisplay } from "@/lib/DisplayContext";
import type { SubjectProfile } from "@/types";
import { PageFrame } from "@/components/admin/kit";
import { FittedPostcard } from "@/components/admin/PostcardPreview";
import { cardPill, isUnfinished, PILL_STYLE } from "@/lib/cardState";
import { listState } from "@/lib/listState";

/**
 * One card — frame 18h: the object, its facts, and where it has got to.
 *
 * The timeline is the reason this page exists. A family who sent a card three
 * weeks ago has exactly one question, and the word "sent" does not answer it.
 * Five stops, each either dated or plainly not reached yet, so the answer is
 * read rather than inferred from a status word.
 */

/**
 * The five stops, and the card states that mean each one has happened.
 *
 * Written as "which states count as past this point" rather than as a position
 * in a list, because the states are not a single line — `returned` is further
 * along than `shipped` in time but is not `delivered`, and a list index would
 * quietly call it delivered. Membership cannot make that mistake.
 */
const STOPS: ReadonlyArray<{
  key: string;
  label: string;
  reachedBy: ReadonlyArray<string>;
  at: (card: NfcCard) => string | null;
}> = [
  { key: "created", label: "CREATED", reachedBy: [], at: (c) => c.created_at },
  {
    key: "prepared",
    label: "PREPARED",
    reachedBy: ["queued", "printing", "shipped", "sent", "delivered", "returned"],
    at: () => null,
  },
  {
    key: "printed",
    label: "PRINTED",
    reachedBy: ["printing", "shipped", "sent", "delivered", "returned"],
    at: () => null,
  },
  {
    key: "shipped",
    label: "SHIPPED",
    reachedBy: ["shipped", "sent", "delivered", "returned"],
    at: (c) => c.sent_at,
  },
  { key: "delivered", label: "DELIVERED", reachedBy: ["delivered"], at: (c) => c.delivered_at },
];

/** Short dates, as the frame draws them: "25 Aug", and "today" for today. */
function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  return sameDay ? "today" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function longDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { dateStyle: "long" });
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p
        className="font-mono text-[10.5px] uppercase"
        style={{ letterSpacing: ".12em", color: "var(--fg-faint)" }}
      >
        {label}
      </p>
      <p className="mt-1.5 text-[14px]" style={{ color: value ? "var(--fg)" : "var(--fg-faint)" }}>
        {value || "—"}
      </p>
    </div>
  );
}

/** The five dots and the line between them (18h). */
function Timeline({ card }: { card: NfcCard }) {
  const state = card.state ?? "draft";
  const reached = STOPS.map((s) => s.key === "created" || s.reachedBy.includes(state));
  /* The current stop is the last one reached — it gets the open ring, and the
     line leaving it goes faint because nothing past it has happened. */
  const current = reached.lastIndexOf(true);

  return (
    <div className="mt-4 flex items-start">
      {STOPS.map((stop, i) => {
        const done = reached[i];
        const isCurrent = i === current;
        const when = shortDate(stop.at(card));
        return (
          <div key={stop.key} className="flex flex-1 flex-col gap-[9px]">
            <div className="flex items-center">
              <span
                className="box-border size-[11px] flex-none rounded-full"
                style={
                  isCurrent
                    ? { background: "transparent", border: "1.5px solid var(--accent-soft)" }
                    : done
                      ? { background: "var(--accent-soft)" }
                      : { background: "rgba(var(--ink),.14)" }
                }
              />
              {i < STOPS.length - 1 && (
                <span
                  className="mx-1.5 h-px flex-1"
                  style={{
                    background: done && !isCurrent ? "var(--accent-tint)" : "var(--line-soft)",
                  }}
                />
              )}
            </div>
            <div
              className="font-mono text-[10.5px] uppercase leading-[1.4]"
              style={{ letterSpacing: ".1em", color: done ? "var(--fg)" : "var(--fg-faint)" }}
            >
              {stop.label}
            </div>
            {/*
              A stop with no date left blank, exactly as the frame draws it —
              rather than a dash, which reads as a date we had and lost.
            */}
            <div className="-mt-1 text-[11px] leading-[1.4]" style={{ color: "var(--fg-faint)" }}>
              {done ? (when ?? "") : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pill({
  children,
  tone = "outline",
  onClick,
}: {
  children: React.ReactNode;
  tone?: "primary" | "outline" | "quiet";
  onClick: () => void;
}) {
  const style =
    tone === "primary"
      ? { background: "var(--chip-on)", color: "var(--on-chip-on)", border: "1px solid transparent" }
      : tone === "quiet"
        ? { border: "1px solid var(--line-soft)", color: "var(--fg-faint)" }
        : { border: "1px solid rgba(var(--ink),.22)", color: "var(--fg)" };
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none"
      style={style}
    >
      {children}
    </button>
  );
}

/** The arrived card's code, taught to its row (PATCH /nfc-cards/:id). */
function TeachTag({ cardId }: { cardId: string }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const teach = useMutation({
    mutationFn: () => api.patch(`/nfc-cards/${cardId}`, { tag_code: code.trim() }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["nfc-cards"] }),
  });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Card code"
        aria-label="Card code"
        className="min-h-[44px] rounded-[10px] bg-transparent px-3 py-2 font-mono text-[14px] outline-none focus:border-accent sm:min-h-0"
        style={{ border: "1px solid rgba(var(--ink),.2)", color: "var(--fg)" }}
      />
      <button
        type="button"
        disabled={!code.trim() || teach.isPending}
        onClick={() => teach.mutate()}
        className="min-h-[44px] rounded-full px-4 py-2 text-[13px] font-medium disabled:opacity-50 sm:min-h-0"
        style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
      >
        {teach.isPending ? "Linking…" : "Link it"}
      </button>
      {teach.isError && (
        <p className="text-[13px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
          It could not be linked. The card is unchanged.
        </p>
      )}
    </div>
  );
}

export function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { subjectName } = useDisplay();
  const [face, setFace] = useState<"front" | "back">("front");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  /*
    Read from the list the page already holds rather than a detail route: every
    route into here comes from the overview, so the card is in cache, and there
    is no second shape of the same thing to keep in step.
  */
  const { data: cards, isPending, isError } = useNfcCards();
  const state = listState({ isPending, isError, count: cards?.length ?? 0 });
  const card = (cards ?? []).find((c) => c.id === id) ?? null;

  /* Where a card is posted — the same source the send flow uses (18f), with
     the same disclosed limit: `residence` is the profile's "Living place", so
     on most archives it is a town rather than a postal address. */
  const { data: subject } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/nfc-cards/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
      navigate("/admin/cards");
    },
  });

  const back = (
    <button
      type="button"
      onClick={() => navigate("/admin/cards")}
      className="-my-3.5 self-start py-3.5 font-mono text-xs text-fg-faint hover:text-fg sm:my-0 sm:py-0"
    >
      ← Cards
    </button>
  );

  if (state !== "ready" || !card) {
    return (
      <PageFrame type="roster" header={back}>
        <p className="text-fg-muted" role={state === "error" ? "alert" : undefined}>
          {state === "loading"
            ? "Loading…"
            : state === "error"
              ? "This card could not be loaded, so we cannot say where it has got to."
              : "This card was not found. It may have been deleted."}
        </p>
      </PageFrame>
    );
  }

  const pill = cardPill(card);
  const n = card.channel?.number;
  const number = typeof n === "number" ? String(n).padStart(2, "0") : "--";
  const unfinished = isUnfinished(card);
  const canDelete = profile?.role === "admin";
  const who = card.recipient?.name?.trim() || subjectName?.trim() || "her";
  const from = card.sender?.name?.trim() || profile?.name?.trim() || null;

  return (
    <PageFrame type="roster" header={back}>
      <div className="grid max-w-[1180px] grid-cols-1 gap-12 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* ── The card itself, both faces ──────────────────────────────── */}
        <div>
          <div className="flex gap-2">
            {(["front", "back"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFace(f)}
                className="min-h-[44px] sm:min-h-0 rounded-full px-4 py-1.5 text-[12.5px] capitalize leading-none"
                style={
                  face === f
                    ? { background: "var(--chip-on)", color: "var(--on-chip-on)" }
                    : { border: "1px solid var(--line-soft)", color: "var(--fg-faint)" }
                }
                aria-pressed={face === f}
              >
                {f}
              </button>
            ))}
          </div>
          {/* 620×440 at 0.62 is 384px of card — wider than a 390 phone's
              column once the frame's padding is taken off. Fitted, so the
              desktop keeps its size and the phone gets one that fits. */}
          <div className="mt-4 w-full lg:w-[384px]">
            <FittedPostcard
              card={{ ...card, archive_since: subject?.archive_since ?? null }}
              face={face}
              max={0.62}
            />
          </div>
        </div>

        {/* ── Its facts ────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[32px] leading-none">{number}</span>
            <span className="min-w-0 flex-1 truncate text-[24px]">
              {card.channel?.title ?? card.label}
            </span>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-[11px] leading-none"
              style={PILL_STYLE[pill.tone]}
            >
              {pill.label}
            </span>
          </div>

          {card.channel?.description && (
            <p className="mt-3 max-w-prose text-[15px] leading-[1.6] text-fg-muted">
              {card.channel.description}
            </p>
          )}

          {/* The linked channel is the first thing after the name — a card is
              a way into a channel, so the channel is the card's real subject. */}
          {card.channel && (
            <div className="mt-6 flex flex-wrap items-baseline gap-3">
              <span
                className="font-mono text-[11px] uppercase"
                style={{ letterSpacing: ".12em", color: "var(--accent-soft)" }}
              >
                Linked channel · {number} {card.channel.title}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/admin/edit-channel/${card.channel!.id}`)}
                className="inline-flex h-8 items-center rounded-full border px-3.5 text-[12.5px] font-medium"
                style={{ borderColor: "rgba(var(--ink),.22)" }}
              >
                View channel
              </button>
            </div>
          )}

          <div
            className="mt-6 grid grid-cols-2 gap-x-8 gap-y-6 border-t pt-6 sm:grid-cols-3"
            style={{ borderColor: "var(--line-soft)" }}
          >
            <Fact label="Card type" value={card.kind === "postcard" ? "Postcard" : "Connected card"} />
            <Fact label="To" value={card.recipient?.name} />
            <Fact
              label="From"
              value={
                from
                  ? [from, card.sender?.relationship?.toLowerCase()].filter(Boolean).join(", ")
                  : null
              }
            />
            <Fact label="Created" value={longDate(card.created_at)} />
            <Fact label="Sent" value={longDate(card.sent_at)} />
            <Fact label="Delivery" value={subject?.delivery_address?.trim() || null} />
          </div>

          {/* ── Where it has got to ───────────────────────────────────── */}
          {card.kind === "postcard" && (
            <div className="mt-6 border-t pt-6" style={{ borderColor: "var(--line-soft)" }}>
              <p
                className="font-mono text-[12px] uppercase"
                style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
              >
                Delivery
              </p>
              <Timeline card={card} />

              {card.state === "returned" && (
                /* 18k's failed-delivery panel, on the card it happened to. The
                   address check comes before the resend because the address is
                   almost always the fault. */
                <div
                  className="mt-6 rounded-[16px] p-4"
                  style={{ border: "1px solid var(--destructive-soft)" }}
                >
                  <p className="text-[15px]">The card couldn&apos;t be delivered.</p>
                  <p className="mt-1.5 max-w-[54ch] text-[13px] leading-[1.6] text-fg-faint">
                    It came back to us
                    {card.returned_at ? ` on ${longDate(card.returned_at)}` : ""}. The address may
                    be wrong — check it and we&apos;ll send it again free.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Pill onClick={() => navigate("/admin/settings")}>Check address</Pill>
                    <Pill tone="primary" onClick={() => navigate("/admin/cards/new")}>
                      Send again
                    </Pill>
                  </div>
                </div>
              )}
            </div>
          )}

          {/*
            An ordered NFC card that has arrived (owner-directed): it shipped
            with a coded sticker, and this is where the code meets the row.
            Only for kind nfc with no tag yet — a taught card has nothing to
            finish, and a postcard never has a tag at all.
          */}
          {card.kind === "nfc" && !card.tag_code && (
            <div className="mt-6 border-t pt-6" style={{ borderColor: "var(--line-soft)" }}>
              <p className="label-caps">Has the card arrived?</p>
              <p className="mt-2 max-w-[52ch] text-[13px] leading-[1.6] text-fg-faint">
                Tap it on the reader now — it types its own code — or copy the code printed on
                it. That finishes the card: from then on a tap opens the channel.
              </p>
              <TeachTag cardId={card.id} />
            </div>
          )}

          {/* ── What you can do next ──────────────────────────────────── */}
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Pill tone="primary" onClick={() => navigate("/admin/cards/new")}>
              Send another
            </Pill>
            {/*
              Duplicate carries the channel and the photo across, which is the
              whole of its promise — so it is only offered when both are
              actually known. A card whose photo was deleted cannot be
              duplicated into the same card, and saying so by absence beats a
              button that quietly drops half of what it kept.
            */}
            {card.channel_id && card.media_file_id && (
              <Pill
                onClick={() =>
                  navigate(
                    `/admin/cards/new?channel=${card.channel_id}&photo=${card.media_file_id}`
                  )
                }
              >
                Duplicate
              </Pill>
            )}
            {/*
              Edit belongs to a card that has not gone anywhere. Once it is in
              the post there is nothing on this screen that editing could
              change, and the frame's own caption for a sent card is about
              sending another — so the control is absent rather than inert.
            */}
            {unfinished && (
              <Pill onClick={() => navigate(`/admin/cards/new?channel=${card.channel_id ?? ""}`)}>
                Edit card
              </Pill>
            )}
            {canDelete && (
              <Pill tone="quiet" onClick={() => setConfirmingDelete(true)}>
                Delete card
              </Pill>
            )}
          </div>

          <p
            className="mt-3 max-w-[62ch] font-mono text-[13px] leading-[1.7]"
            style={{ letterSpacing: ".04em", color: "var(--fg-faint)" }}
          >
            Send another keeps {from ?? "you"} and {who} and asks only the two real questions:
            which channel, which photo.
          </p>

          {confirmingDelete && (
            <div
              className="mt-4 rounded-[16px] p-4"
              style={{ border: "1px solid var(--destructive-soft)" }}
            >
              <p className="text-[15px]">Delete this card?</p>
              <p className="mt-1.5 max-w-[54ch] text-[13px] leading-[1.6] text-fg-faint">
                {card.tag_code
                  ? "The physical card stops opening its channel. Nothing in the channel itself is touched."
                  : "The record of this card goes. The channel and its photographs stay."}
              </p>
              {remove.isError && (
                <p className="mt-2 text-[13px]" role="alert" style={{ color: "var(--destructive)" }}>
                  It could not be deleted. Nothing has changed.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill onClick={() => setConfirmingDelete(false)}>Keep it</Pill>
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate()}
                  className="min-h-[44px] sm:min-h-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-[9px] text-[13px] font-medium leading-none disabled:opacity-60"
                  style={{ background: "var(--destructive)", color: "var(--cream)" }}
                >
                  {remove.isPending ? "Deleting…" : "Delete card"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
