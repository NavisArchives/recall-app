import { CreditCard, ImageIcon } from "lucide-react";
import { thumb } from "@/lib/thumb";
import { Link } from "react-router-dom";
import type { Channel } from "@/types";

/**
 * A channel as the 20a shelf draws it: the photograph fills the tile and
 * everything else sits on top of it.
 *
 * The scrim is what makes that safe. A title laid straight onto a photograph
 * is legible until somebody uploads a bright one, so the gradient is part of
 * the tile rather than a nicety — the same reasoning as the display's scrim.
 *
 * The channel on her screen is the exception the frame makes: it takes the
 * amber border and the LIVE badge stands where the number chip would, with
 * the number moving inline beside the title. One channel can be live, so one
 * tile is allowed to shout.
 */
export function ChannelTile({
  channel,
  live = false,
  linked = false,
  cardsUnread = false,
  linking = false,
  needsDescriptions = 0,
  to,
}: {
  channel: Channel;
  live?: boolean;
  /*
    Whether a card opens this channel. It comes from the caller because the
    link lives on the *card* — a channel does not know what points at it, and
    inventing a field on it here would put the same fact in two places.
  */
  linked?: boolean;
  /**
   * The card list has not been read (M208).
   *
   * `linked` is a boolean, and a boolean cannot say "we did not ask". When
   * the NFC read failed, every tile received `linked={false}` and announced
   * **"no card yet"** in the warning colour, with `aria-label="No card
   * linked"` underneath it.
   *
   * That is worse than a wrong figure: it tells a family to go and do
   * something *physical* — find the card, re-tap it, re-provision it — about
   * cards that are working perfectly, on a page showing no error anywhere.
   * A third state costs one prop and says nothing instead.
   */
  cardsUnread?: boolean;
  linking?: boolean;
  needsDescriptions?: number;
  to: string;
}) {
  const count = channel.photo_count ?? channel.media_count ?? 0;
  const number = String(channel.number).padStart(2, "0");

  /*
    The meta line reads type · count · state, and the state is where the
    tile earns its keep: a warning is the reason somebody would open this
    channel rather than another. Amber only when something is owed.
  */
  const state: { text: string; warn: boolean } = linking
    ? { text: "card linking in progress", warn: true }
    : needsDescriptions > 0
      ? { text: `${needsDescriptions} need descriptions`, warn: true }
      : cardsUnread
        ? /*
             Not "no card yet", and not a warning: the cards are unknown, so
             the tile falls back to the one thing it does know. Amber here
             would be an alarm about somebody else's failure.
          */
          { text: "", warn: false }
        : linked
          ? { text: "card linked", warn: false }
          : { text: "no card yet", warn: true };

  return (
    <Link
      to={to}
      className="pressable relative block overflow-hidden rounded-[26px]"
      style={{
        // The frame's proportion, held by the tile itself: 446 x 210 at three
        // columns of 1440. Fixing the shape here is what stops the grid
        // resizing its cards when a filter changes the number of rows.
        aspectRatio: "212 / 100",
        border: live ? "1px solid var(--accent)" : "1px solid rgba(var(--ink),.09)",
      }}
    >
      {channel.cover_url ? (
        <img src={thumb(channel.cover_url, 640)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-[rgba(var(--ink),0.02)]">
          <ImageIcon className="h-7 w-7" style={{ color: "rgba(var(--ink-cream),.28)" }} aria-hidden />
        </span>
      )}

      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(11,11,12,.85), rgba(11,11,12,.2) 48%, transparent 68%)",
        }}
      />

      <span className="on-media absolute inset-x-3.5 top-3.5 flex items-center justify-between">
        {live ? (
          <span
            className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 font-mono text-[10px] tracking-[0.16em]"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            <span className="h-[6px] w-[6px] rounded-full" style={{ background: "#fff" }} />
            LIVE · ON SCREEN
          </span>
        ) : (
          <span
            className="rounded-[9px] px-2.5 py-[7px] font-mono text-[12px] font-medium leading-none"
            style={{
              background: "rgba(11,11,12,.55)",
              backdropFilter: "blur(6px)",
              color: "rgba(var(--ink-cream),.9)",
            }}
          >
            {number}
          </span>
        )}

        {/*
          The NFC state is a ring whose *border* says which state it is —
          solid when a card opens this channel, dashed when none does. A
          colour alone would not survive a printed page or an amber
          photograph behind it.
        */}
        <span
          aria-label={
            cardsUnread
              ? "Whether a card opens this channel could not be checked"
              : linked
                ? "A card opens this channel"
                : "No card linked"
          }
          className="inline-flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full"
          style={{
            border: cardsUnread
              ? "1.5px solid rgba(var(--ink-cream),.18)"
              : linked
                ? "1.5px solid rgba(var(--ink-cream),.75)"
                : "1.5px dashed var(--fg-quiet)",
            opacity: cardsUnread ? 0.5 : 1,
            background: "rgba(11,11,12,.35)",
          }}
        >
          <CreditCard size={13} strokeWidth={1.7} style={{ color: "rgba(var(--ink-cream),.8)" }} aria-hidden />
        </span>
      </span>

      <span className="on-media absolute inset-x-5 bottom-[18px] block">
        <span className="flex items-baseline gap-2.5">
          {live && (
            <span className="font-mono text-[13px]" style={{ color: "var(--fg-soft)" }}>
              {number}
            </span>
          )}
          <span
            className="text-[21px] font-semibold leading-[1.15]"
            style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
          >
            {channel.title}
          </span>
        </span>
        <span
          className="mt-1.5 block text-[12px] leading-[1.4]"
          style={{ color: "rgba(var(--ink-cream),.75)" }}
        >
          {channel.content_type} · {count} {count === 1 ? "photograph" : "photographs"} ·{" "}
          <span style={{ color: state.warn ? "var(--accent-soft)" : "rgba(var(--ink-cream),.75)" }}>
            {state.text}
          </span>
        </span>
      </span>
    </Link>
  );
}
