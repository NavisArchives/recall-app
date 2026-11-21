import { useEffect, useMemo, useState } from "react";
import { thumb } from "@/lib/thumb";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useChannels, usePeople, type NfcCard } from "@/hooks/useAdminData";
import { useDisplay } from "@/lib/DisplayContext";
import { PostcardFront, PostcardBack } from "@/components/admin/PostcardPreview";
import { listState } from "@/lib/listState";
import type { Channel, MediaFile, SubjectProfile } from "@/types";

/**
 * Making a postcard — frames 18b → 18c → 18eb → 18g, with 18f inside 18eb.
 *
 * Four steps, and the order is the argument: the channel is asked first
 * because it is the only real question (18b), the photograph second and from
 * the channel's own pictures (18c), then one screen that shows the finished
 * card (18eb), then it is gone (18g).
 *
 * Nothing is written until Send. The flow holds its own state because a
 * half-answered card is not something a family should find in their list
 * later, and the route that finally takes it writes the whole card at once.
 *
 * This page frames itself rather than using `PageFrame`: every frame in the
 * series is a fixed-height screen with the stepper pinned at the top and a
 * footer rule at the bottom, and the roster frame's scrolling column cannot
 * hold that shape.
 */

const STEPS = ["CHANNEL", "PHOTO", "CHECK", "SEND"] as const;
/* The NFC path is shorter: the card exists, it only needs teaching. */
const NFC_STEPS = ["CHANNEL", "LINK", "DONE"] as const;

/**
 * The stepper — 18b's own measurements.
 *
 * Numbered dots joined by a line, the done ones ticked in amber; the back
 * arrow sits absolutely at the left so the steps stay centred in the frame
 * regardless of it. Deliberately the same language as 18h's delivery
 * timeline: the family sees the whole cost of the flow up front, and then
 * sees the same shape again for the card's journey.
 */
function StepRail({
  step,
  onBack,
  steps = STEPS,
}: {
  step: number;
  onBack: () => void;
  steps?: readonly string[];
}) {
  return (
    <div className="relative flex h-10 flex-none items-center justify-center">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="absolute left-0 inline-flex size-11 items-center justify-center rounded-full sm:size-10"
        style={{ border: "1px solid rgba(var(--ink),.22)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5" />
          <path d="M12 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="flex items-center">
        {steps.map((label, i) => {
          const done = i < step;
          const here = i === step;
          return (
            <span key={label} className="flex items-center">
              {i > 0 && (
                <span
                  className="mx-3 h-px w-9"
                  style={{ background: "rgba(var(--ink),.14)" }}
                  aria-hidden
                />
              )}
              <span className="inline-flex items-center gap-[9px]">
                <span
                  className="box-border inline-flex size-6 items-center justify-center rounded-full text-[11px] font-medium leading-none"
                  style={
                    done || here
                      ? {
                          background: "var(--accent-tint)",
                          color: "var(--accent-soft)",
                          border: "1px solid var(--accent-soft)",
                        }
                      : {
                          background: "transparent",
                          color: "var(--fgw-dim)",
                          border: "1px solid rgba(var(--ink),.22)",
                        }
                  }
                >
                  {done ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 12.5 9.5 18 20 6.5" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className="font-mono text-[10.5px] leading-none"
                  style={{
                    letterSpacing: ".14em",
                    color: done || here ? "var(--fg)" : "var(--fgw-dim)",
                  }}
                >
                  {label}
                </span>
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** The cream primary and the outlined secondary, as every frame draws them. */
function Pill({
  children,
  onClick,
  tone = "outline",
  disabled,
  big,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "primary" | "outline";
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-full font-medium leading-none disabled:opacity-40 sm:min-h-0 ${
        big ? "px-[22px] py-[11px] text-[13.5px]" : "px-4 py-[9px] text-[13px]"
      }`}
      style={
        tone === "primary"
          ? { background: "var(--chip-on)", color: "var(--on-chip-on)", border: "1px solid transparent" }
          : { border: "1px solid rgba(var(--ink),.22)", color: "var(--fg)" }
      }
    >
      {children}
    </button>
  );
}

/** A mono note in the frames' own voice — 13px, .04em, muted. */
function Note({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[13px] leading-[1.7] ${className}`}
      style={{ letterSpacing: ".04em", color: "var(--fg-faint)" }}
    >
      {children}
    </div>
  );
}

/** One stacked fact, as 18eb draws them: mono label in a 120px column. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-[18px]">
      <div
        className="font-mono text-[11px] uppercase leading-none"
        style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
      >
        {label}
      </div>
      <div className="text-[15px] leading-[1.4]">{children}</div>
    </div>
  );
}

export function NewPostcardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { subjectName } = useDisplay();

  /*
    Duplicate (18h) arrives here with the channel and the photo already chosen,
    so the flow opens at CHECK rather than making somebody re-pick the two
    things they just said they wanted to keep. Anything else — a bare "Send
    another", a typed URL, a half-filled link — starts at CHANNEL, because a
    step is only safe to skip when the value it produces is actually present.
  */
  const [params] = useSearchParams();
  const prefillChannel = params.get("channel");
  const prefillPhoto = params.get("photo");
  const duplicating = !!(prefillChannel && prefillPhoto);

  const [step, setStep] = useState(duplicating ? 2 : 0);
  /*
    Which physical thing is being made (owner-directed): a postcard we print
    and post, or an NFC card the family already holds that needs teaching its
    channel. One flow, one first screen — the choice is a visible pair of
    buttons now rather than a quiet link, because the link was invisible to
    exactly the person standing there with a tap card in their hand.
  */
  const [kind, setKind] = useState<"postcard" | "nfc">("postcard");
  const [tagCode, setTagCode] = useState("");
  const [nfcDone, setNfcDone] = useState<NfcCard | null>(null);
  const [channelId, setChannelId] = useState<string | null>(prefillChannel);
  const [mediaId, setMediaId] = useState<string | null>(prefillPhoto);
  const [senderId, setSenderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<NfcCard | null>(null);

  /*
    Where the card is posted (18f). The address belongs to the PERSON, not to
    the card — "change it once and every card follows" — so it is read here
    rather than stored on the card, and a card made last month posts to
    wherever she lives now.

    ⚠ This reads the subject's `residence` from settings, which is the only
    address field every role can see. It is the field the profile page labels
    "Living place", so on most archives it is a town rather than a postal
    address — enough to confirm against, not enough to print a label from.
    The frame draws a full address; wiring a real postal one is its own piece
    of work, and pretending otherwise here would put a half-address on an
    envelope.
  */
  const { data: subject } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SubjectProfile | null>("/settings"),
  });
  /*
    The POSTAL address (053) — the field 18f always wanted. The old read fell
    back to `residence`, disclosed at the time as "a town, not a label" —
    that hedge closes now the real column exists: only a genuine postal
    address counts, and its absence sends the admin to Settings to add one
    rather than letting a card sail toward "Bruges".
  */
  const subjectAddress = subject?.delivery_address?.trim() || null;

  const { data: channels, isPending: channelsPending, isError: channelsFailed } = useChannels();
  const channelState = listState({
    isPending: channelsPending,
    isError: channelsFailed,
    count: channels?.length ?? 0,
  });
  const channel = (channels ?? []).find((c) => c.id === channelId) ?? null;

  /*
    A prefill is a claim about the archive, not a fact, so it is checked once
    the channels are actually in hand. If that channel is gone — deleted since
    the card was sent, or a mistyped link — the flow drops back to CHANNEL
    rather than showing a CHECK step with nothing on the card.
  */
  useEffect(() => {
    if (duplicating && channelState === "ready" && !channel) {
      setChannelId(null);
      setMediaId(null);
      setStep(0);
    }
  }, [duplicating, channelState, channel]);

  /*
    18c: the grid is the channel's OWN photographs — the brief's priority — so
    it only exists once a channel has been chosen.

    Read from the channel's own detail route, which already returns its media
    with usable urls. There is no list endpoint for media files (I looked for
    one and briefly invented it, which is how this step came to say the photos
    could not be loaded), and adding one would be a second way to ask the same
    question.
  */
  const { data: detail, isPending: mediaPending, isError: mediaFailed } = useQuery({
    queryKey: ["channel", channel?.number],
    queryFn: () => api.get<Channel & { media?: MediaFile[] }>(`/channels/${channel!.number}`),
    enabled: !!channel,
  });
  const photos = useMemo(
    () => (detail?.media ?? []).filter((m) => m.file_type !== "video"),
    [detail]
  );
  const mediaState = listState({
    isPending: mediaPending,
    isError: mediaFailed,
    count: photos.length,
  });

  /* 18eb's FROM chips. The roster the workspace already holds — the sender is
     whoever the family says it is from, not necessarily whoever is typing. */
  const { data: people } = usePeople();
  /*
    Everyone except the subject. The card is addressed TO her, and a chip
    offering to send it FROM her as well is not a real choice — it is the
    recipient standing in the sender list. `role !== "user"` is the same rule
    the contributors page and the social screen use to mean "not the person
    the archive is for", so there is one definition of that and not three.
  */
  const senders = (people ?? []).filter((p) => p.role !== "user");
  const sender =
    senders.find((p) => p.id === senderId) ?? senders.find((p) => p.id === profile?.id) ?? null;

  /* The preview is the real component fed the real values — 18eb's LIVE tag
     is a promise that this is the card, so it must not be a second drawing. */
  const draft = useMemo<NfcCard | null>(() => {
    if (!channel) return null;
    const photo = photos.find((p) => p.id === mediaId) ?? null;
    return {
      id: "preview",
      label: "Postcard",
      tag_code: null,
      channel_id: channel.id,
      linked_object: null,
      created_at: new Date().toISOString(),
      kind: "postcard",
      state: "draft",
      media_file_id: mediaId,
      recurrence: "once",
      photo_mode: "chosen",
      next_send_at: null,
      sent_at: null,
      delivered_at: null,
      shipping_reference: null,
      archive_since: subject?.archive_since ?? null,
      channel: {
        id: channel.id,
        number: channel.number,
        title: channel.title,
        description: channel.description,
      },
      photo: photo ? { id: photo.id, url: photo.url ?? "", caption: photo.caption } : null,
      sender: sender
        ? { id: sender.id, name: sender.name, relationship: sender.relationship ?? null }
        : null,
      recipient: subjectName ? { id: "subject", name: subjectName } : null,
    } as NfcCard;
  }, [channel, photos, mediaId, sender, subjectName]);

  async function send() {
    if (!channelId || !mediaId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<NfcCard>("/nfc-cards/postcards", {
        channel_id: channelId,
        media_file_id: mediaId,
        photo_mode: "chosen",
        recurrence: "once",
        state: "ready",
        ...(senderId ? { from_person_id: senderId } : {}),
      });
      const posted = await api.post<NfcCard>(`/nfc-cards/${created.id}/send`, {});
      await queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
      setSent(posted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The card could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const who = subjectName?.trim() || "her";
  const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

  /* ── 18g — sent. Warm, not ecommerce: no order number, no receipt. ──── */
  if (sent) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center px-8 py-8 text-center">
        <div className="w-full max-w-[420px]">
          <PostcardFront card={sent} scale={0.58} />
        </div>
        <h1 className="mt-7 text-[28px] font-bold leading-[1.2]">
          Your card is on its way to {who}.
        </h1>
        <div className="mt-3 flex items-baseline justify-center gap-2.5">
          <span className="font-mono text-[26px] font-light leading-none">
            {String(sent.channel?.number ?? 0).padStart(2, "0")}
          </span>
          <span className="text-[17px]">{sent.channel?.title}</span>
        </div>
        <p className="mt-2 text-[14px] text-fg-muted">
          To {who}
          {sent.sender?.name ? ` · From ${sent.sender.name}` : ""}
          {sent.sender?.relationship ? `, ${sent.sender.relationship.toLowerCase()}` : ""}
        </p>
        <p
          className="mt-4 inline-block rounded-full px-3 py-1.5 text-[12.5px] leading-none"
          style={{ background: "var(--accent-tint)", color: "var(--accent-soft)" }}
        >
          preparing for delivery
        </p>
        <Note className="mt-4">
          We print it and post it — usually with {who} in three or four days.
        </Note>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Pill tone="primary" onClick={() => navigate("/admin/cards")}>
            Back to Cards
          </Pill>
          <Pill onClick={() => navigate(`/admin/cards/${sent.id}`)}>View card</Pill>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-8 pb-7 pt-5">
      <StepRail
        step={step}
        steps={kind === "nfc" ? NFC_STEPS : STEPS}
        onBack={() => (step === 0 ? navigate("/admin/cards") : setStep(step - 1))}
      />

      {/* ── 18b — the only real question, asked first ─────────────────── */}
      {step === 0 && (
        <>
          <div className="mt-[26px] flex-none text-center">
            <h1 className="text-[28px] font-bold leading-[1.2]">
              What do you want this card to open?
            </h1>
            <p className="mt-[9px] text-[14px] leading-[1.6] text-fg-muted">
              Choose a channel. The card takes its number, title and description from it — you
              won&apos;t type them again.
            </p>
            {/* The two kinds, as buttons (owner-directed). A postcard is
                printed and posted; an NFC card is a thing already in the
                room that needs teaching which channel it opens. */}
            <div
              className="mx-auto mt-4 inline-flex gap-0.5 rounded-full p-[3px]"
              style={{ background: "rgba(var(--ink),.05)", border: "1px solid var(--line-soft)" }}
              role="radiogroup"
              aria-label="Card kind"
            >
              {([
                ["postcard", "Postcard — we print and post it"],
                ["nfc", "Connected card — tap to link one"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className="min-h-[44px] rounded-full px-[15px] py-[8px] text-[12.5px] leading-none sm:min-h-0"
                  style={
                    kind === value
                      ? { background: "var(--chip-on)", color: "var(--on-chip-on)", fontWeight: 500 }
                      : { color: "var(--fg-muted)" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {channelState !== "ready" ? (
            <p className="mt-8 text-center text-fg-muted" role={channelState === "error" ? "alert" : undefined}>
              {channelState === "loading"
                ? "Loading…"
                : channelState === "error"
                  ? "Your channels could not be loaded, so this list is incomplete. Try again in a moment."
                  : "There are no channels yet — a card has to open one."}
            </p>
          ) : (
            <div /*
                `auto-rows-max` is load-bearing. Inside a definite-height flex
                child the grid distributed its rows to fill the column — 153px
                each for 178px of tile — and `overflow-hidden` on the tile
                turned that into a clean crop straight through the channel
                title. It read as a design choice rather than as a bug, which
                is the expensive kind. Rows sized by content, the column
                scrolls.
              */
              className="scroll-thin mt-[30px] grid min-h-0 flex-1 auto-rows-max content-start grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-4">
              {(channels ?? []).map((c: Channel) => {
                const chosen = c.id === channelId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      if (c.id !== channelId) setMediaId(null);
                      setChannelId(c.id);
                    }}
                    aria-pressed={chosen}
                    /* The number reads "06" to the eye and "six" to a screen
                       reader, and the tile's own text is split across three
                       elements — so the label is written once, whole, the way
                       a person would say it. */
                    aria-label={`Channel ${String(c.number).padStart(2, "0")}, ${c.title}`}
                    className="pressable relative overflow-hidden rounded-[20px] text-left"
                    style={{
                      border: chosen ? "1px solid var(--accent-soft)" : "1px solid var(--line-soft)",
                      background: "rgba(var(--ink),.02)",
                    }}
                  >
                    <div className="relative h-[118px] overflow-hidden">
                      {c.cover_url ? (
                        <img src={thumb(c.cover_url, 640)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        /* A channel with no picture yet says so, rather than
                           showing a grey rectangle that reads as a failed
                           image load. */
                        <span
                          className="flex h-full w-full items-center justify-center text-[12px]"
                          style={{ background: "rgba(var(--ink),.05)", color: "var(--fg-faint)" }}
                        >
                          No picture yet
                        </span>
                      )}
                    </div>
                    <div className="px-4 pb-4 pt-3.5">
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-[30px] font-light leading-none">
                          {String(c.number).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-[1.2]">
                          {c.title}
                        </span>
                      </div>
                      {c.description && (
                        <p className="mt-2 line-clamp-3 text-[12.5px] leading-[1.55] text-fg-faint">
                          {c.description}
                        </p>
                      )}
                    </div>
                    {chosen && (
                      <span
                        className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full"
                        style={{ background: "var(--chip-on)" }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="var(--on-chip-on)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="4 12.5 9.5 18 20 6.5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* The footer repeats the consequence in mono before Continue —
              the choice is stated back before it is committed to. */}
          <div
            className="mt-5 flex flex-none items-center justify-between gap-4 pt-5"
            style={{ borderTop: "1px solid var(--line-soft)" }}
          >
            <Note>
              {channel
                ? `This card opens channel ${String(channel.number).padStart(2, "0")} · ${channel.title}`
                : "Choose a channel to continue."}
            </Note>
            <Pill tone="primary" disabled={!channelId} onClick={() => setStep(1)}>
              {kind === "nfc" ? "Continue to the card" : "Continue"}
            </Pill>
          </div>
        </>
      )}

      {/* ── NFC: teach the card its channel ───────────────────────────── */}
      {step === 1 && kind === "nfc" && channel && !nfcDone && (
        <div className="mx-auto mt-10 w-full max-w-[560px] text-center">
          <h1 className="text-[26px] font-bold leading-[1.2]">Link the card</h1>
          <p className="mt-2 text-[14px] leading-[1.6] text-fg-muted">
            Tap the card on the reader now — it types its own code. Or copy the code printed on
            the card into the box.
          </p>
          {/*
            The reader is a keyboard: it TYPES digits wherever the cursor is.
            So the input focuses itself, and a tap fills it with no further
            ceremony — the same trick her display uses to hear cards at all.
          */}
          <input
            autoFocus
            value={tagCode}
            onChange={(e) => setTagCode(e.target.value.trim())}
            placeholder="Card code"
            aria-label="Card code"
            className="mx-auto mt-6 block w-full max-w-[320px] rounded-[12px] bg-transparent px-4 py-3 text-center font-mono text-[18px] tracking-[0.14em] outline-none focus:border-accent"
            style={{ border: "1px solid rgba(var(--ink),.2)", color: "var(--fg)" }}
          />
          {error && (
            <p className="mt-3 text-[13px]" role="alert" style={{ color: "var(--destructive-soft)" }}>
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Pill
              big
              tone="primary"
              disabled={!tagCode || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const card = await api.post<NfcCard>("/nfc-cards", {
                    label: channel.title,
                    tag_code: tagCode,
                    channel_id: channel.id,
                  });
                  await queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
                  setNfcDone(card);
                  setStep(2);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "The card could not be linked.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Linking…" : "Link this card"}
            </Pill>
          </div>
          <Note className="mt-4">
            From then on, tapping it opens channel {String(channel.number).padStart(2, "0")} ·{" "}
            {channel.title}.
          </Note>

          {/*
            The other half (owner-directed): the family may not hold a card at
            all. Recall ships NFC cards too — the sticker and its code arrive
            already on the card — so ordering one here files it into the same
            queue the postcards travel, linked to this channel from birth. The
            code is taught when it is physically in their hands, not invented
            now: which stickers carry which codes is a fulfilment decision.
          */}
          <div className="mt-8 border-t pt-6" style={{ borderColor: "var(--line-soft)" }}>
            <p className="text-[14px] text-fg-muted">Don&apos;t have a card yet?</p>
            <div className="mt-3 flex justify-center">
              <Pill
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const card = await api.post<NfcCard>("/nfc-cards", {
                      label: channel.title,
                      channel_id: channel.id,
                      ordered: true,
                    });
                    await queryClient.invalidateQueries({ queryKey: ["nfc-cards"] });
                    setNfcDone(card);
                    setStep(2);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "The order could not be sent.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Ordering…" : "Send me one — it arrives with its code on it"}
              </Pill>
            </div>
          </div>
        </div>
      )}

      {/* ── NFC: done ─────────────────────────────────────────────────── */}
      {step === 2 && kind === "nfc" && nfcDone && (
        <div className="mx-auto mt-14 w-full max-w-[560px] text-center">
          <h1 className="text-[28px] font-bold leading-[1.2]">
            {nfcDone.tag_code ? "That's the card taught." : "That's the card ordered."}
          </h1>
          <p className="mt-3 text-[15px] leading-[1.7] text-fg-muted">
            {nfcDone.tag_code ? (
              <>
                Tapping it on {who}&apos;s reader now opens{" "}
                <span style={{ color: "var(--fg)" }}>
                  {String(channel?.number ?? 0).padStart(2, "0")} · {channel?.title}
                </span>
                . Nothing to print, nothing to post — it works already.
              </>
            ) : (
              <>
                It arrives with its code already on it, linked to{" "}
                <span style={{ color: "var(--fg)" }}>
                  {String(channel?.number ?? 0).padStart(2, "0")} · {channel?.title}
                </span>
                . When it is in your hands, open it under Cards and tap it once to finish.
              </>
            )}
          </p>
          <div className="mt-7 flex justify-center gap-3">
            <Pill big tone="primary" onClick={() => navigate("/admin/cards")}>
              Back to Cards
            </Pill>
            <Pill
              big
              onClick={() => {
                setNfcDone(null);
                setTagCode("");
                setChannelId(null);
                setStep(0);
              }}
            >
              Link another
            </Pill>
          </div>
        </div>
      )}

      {/* ── 18c — the photograph, the channel's own first ─────────────── */}
      {step === 1 && kind === "postcard" && channel && (
        <>
          <h1 className="mt-[18px] flex-none text-[24px] font-bold leading-[1.2]">
            Choose the photo for the front
          </h1>
          <p className="mt-2 flex-none text-[13.5px] leading-[1.6] text-fg-muted">
            These are the photos already in <span style={{ color: "var(--fg)" }}>{channel.title}</span> —
            the channel this card opens.
          </p>

          {/*
            The grid and the buttons scroll together. The frame puts the action
            row immediately under the photographs — it is not a footer bar the
            way 18b's is, and pinning it to the bottom of the screen left a
            channel with two photographs looking like a mistake.
          */}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
          {mediaState !== "ready" ? (
            <p className="mt-6 text-fg-muted" role={mediaState === "error" ? "alert" : undefined}>
              {mediaState === "loading"
                ? "Loading…"
                : mediaState === "error"
                  ? "The photographs in this channel could not be loaded. Try again in a moment."
                  : "This channel has no photographs yet, so there is nothing to put on the front."}
            </p>
          ) : (
            <div className="mt-5 grid auto-rows-max grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {photos.map((m) => {
                const chosen = m.id === mediaId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMediaId(m.id)}
                    aria-pressed={chosen}
                    /* A photograph with no caption has nothing to be called,
                       so it is numbered — "photo 3 of 8" beats eight buttons
                       that are all called nothing. */
                    aria-label={m.caption?.trim() || `Photo ${photos.indexOf(m) + 1} of ${photos.length}`}
                    /* 4:3, not a fixed 128px strip (owner: "the cards of the
                       pictures is so compressed"). The frame drew 128px rows
                       for eight thumbnails; with three photos they read as
                       squashed letterboxes. An aspect ratio keeps a
                       photograph shaped like a photograph at every count. */
                    className="pressable relative box-border aspect-[4/3] overflow-hidden rounded-[14px]"
                    style={{
                      border: chosen ? "1px solid var(--accent-soft)" : "1px solid transparent",
                    }}
                  >
                    <img src={thumb(m.url, 640)} alt={m.caption ?? ""} className="h-full w-full object-cover" />
                    {chosen && (
                      <span
                        className="absolute bottom-[9px] left-2.5 rounded-full px-[9px] py-1 font-mono text-[9.5px] leading-none"
                        style={{
                          letterSpacing: ".14em",
                          background: "rgba(11,11,12,.72)",
                          color: "var(--accent-soft)",
                        }}
                      >
                        ON THE FRONT
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <Pill tone="primary" disabled={!mediaId} onClick={() => setStep(2)}>
              Use this photo
            </Pill>
            {/*
              Upload is drawn as the quiet second path. It is not wired here:
              an upload has to join the channel so the archive keeps the
              original, and that is the upload page's job — so this goes
              there rather than growing a second uploader that could put a
              photograph on a card without putting it in the archive.
            */}
            <Pill onClick={() => navigate(`/admin/edit-channel/${channel.id}`)}>Upload a photo</Pill>
            <Note className="ml-1.5">
              Uploads join the channel too, so the archive keeps the original.
            </Note>
          </div>
          </div>
        </>
      )}

      {/* ── 18eb — the chosen review, with 18f's address inside it ────── */}
      {step === 2 && kind === "postcard" && draft && (
        <div className="scroll-thin mt-4 grid min-h-0 flex-1 content-center justify-center gap-10 overflow-y-auto lg:grid-cols-[400px_560px] lg:gap-16">
          <div className="flex flex-col items-center gap-3.5">
            <span
              className="inline-flex items-center gap-[9px] rounded-full px-[13px] py-1.5"
              style={{ border: "1px solid rgba(var(--ink),.14)" }}
            >
              <span className="size-1.5 rounded-full" style={{ background: "var(--accent-soft)" }} />
              <span
                className="font-mono text-[9.5px] leading-none"
                style={{ letterSpacing: ".18em", color: "var(--accent-soft)" }}
              >
                LIVE PREVIEW · FILLED FROM YOUR ARCHIVE
              </span>
            </span>
            {/* Front over back, both at the frame's 0.58. */}
            <div className="w-[360px] max-w-full">
              <PostcardFront card={draft} scale={0.58} />
            </div>
            <div className="w-[360px] max-w-full">
              <PostcardBack card={draft} scale={0.58} />
            </div>
            <Note className="max-w-[44ch] text-center">
              This is exactly how your card will be printed.
            </Note>
          </div>

          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-[1.2]">Your card is ready</h1>
            <p className="mt-2 max-w-[48ch] text-[13.5px] leading-[1.55] text-fg-muted">
              Nothing here you haven&apos;t chosen — the channel filled in the rest. Check it once
              and send.
            </p>

            <div
              className="mt-[22px] box-border rounded-[22px] px-6 py-[22px]"
              style={{ background: "rgba(0,0,0,.25)", border: "1px solid rgba(var(--ink),.22)" }}
            >
              <div className="flex flex-col gap-4">
                <Row label="Channel">
                  {String(channel!.number).padStart(2, "0")} — {channel!.title}
                </Row>
                <Row label="Card type">Postcard</Row>
                <Row label="To">{who}</Row>
                {/*
                  18f, folded into the review rather than given its own screen:
                  the address belongs to the person, so the every-time case is
                  one confirmation and there is nothing to type. The missing
                  case says why saving it properly is worth doing instead of
                  just demanding a form.
                */}
                <Row label="Delivery">
                  {subjectAddress ? (
                    <>
                      <span className="whitespace-pre-line">{subjectAddress}</span>
                      <button
                        type="button"
                        onClick={() => navigate("/admin/settings")}
                        className="ml-2 text-[13px] underline underline-offset-2 text-fg-faint hover:text-fg"
                      >
                        Change
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-fg-faint">No delivery address has been added yet.</span>
                      <button
                        type="button"
                        onClick={() => navigate("/admin/settings")}
                        className="ml-2 text-[13px] underline underline-offset-2"
                      >
                        Add address
                      </button>
                    </>
                  )}
                </Row>
              </div>

              <div className="my-[18px] h-px" style={{ background: "var(--line-soft)" }} />

              <div
                className="font-mono text-[11px] uppercase leading-none"
                style={{ letterSpacing: ".14em", color: "var(--fg-faint)" }}
              >
                From
              </div>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {senders.map((p) => {
                  const on = sender?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSenderId(p.id)}
                      aria-pressed={on}
                      className="box-border flex items-center gap-2.5 rounded-full px-3.5 py-2.5"
                      style={{
                        border: on
                          ? "1px solid var(--accent-soft)"
                          : "1px solid var(--line-soft)",
                      }}
                    >
                      <span
                        className="box-border inline-flex size-[26px] flex-none items-center justify-center rounded-full text-[12px] font-light leading-none"
                        style={{
                          background: "rgba(var(--ink),.09)",
                          border: "1px solid rgba(var(--ink),.14)",
                        }}
                      >
                        {initial(p.name)}
                      </span>
                      <span
                        className="text-[13px] font-medium leading-none"
                        style={{ color: on ? "var(--fg)" : "var(--fg-muted)" }}
                      >
                        {p.name}
                      </span>
                      {p.relationship && (
                        <span className="text-[11px] leading-none text-fg-faint">
                          {p.relationship}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => navigate("/admin/contributors/invite")}
                className="mt-3 text-[12.5px] leading-none text-fg-faint hover:text-fg"
              >
                + Add family member
              </button>
            </div>

            {/*
              18k's SOMETHING FAILED. A one-line red sentence was the whole of
              this, and it left the two questions a person actually has —
              have I been charged, and have I lost the card I just made —
              answered nowhere. The frame's rule for both failure panels is
              that the first breath says what did not happen and that nothing
              was lost, so that is what this says.
            */}
            {error && (
              <div
                className="mt-4 rounded-[16px] p-4"
                role="alert"
                style={{ border: "1px solid var(--destructive-soft)" }}
              >
                <p
                  className="font-mono text-[11px] tracking-[0.16em]"
                  style={{ color: "var(--destructive-soft)" }}
                >
                  SOMETHING FAILED
                </p>
                <p className="mt-2 text-[17px]">We couldn&apos;t send the card.</p>
                <p className="mt-1.5 max-w-[52ch] text-[14px] leading-[1.6] text-fg-faint">
                  Nothing was charged. Your card is saved as a draft exactly as you made it.
                </p>
                <div className="mt-3 flex flex-wrap gap-2.5">
                  <Pill tone="primary" onClick={send} disabled={busy}>
                    {busy ? "Trying…" : "Try again"}
                  </Pill>
                  <Pill onClick={() => navigate("/admin/cards")}>Keep as draft</Pill>
                </div>
              </div>
            )}

            <div className="mt-[18px] flex flex-wrap gap-3">
              {/* Without an address there is nowhere to post it, so the button
                  says so rather than failing after the click. */}
              <Pill
                big
                tone="primary"
                onClick={send}
                disabled={busy || !subjectAddress || !mediaId}
              >
                {busy ? "Sending…" : subjectAddress ? "Send card" : "Add an address first"}
              </Pill>
              <Pill big onClick={() => setStep(1)}>
                Edit card
              </Pill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
