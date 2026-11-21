import { Lock } from "lucide-react";
import { thumb } from "@/lib/thumb";
import type { Channel } from "@/types";

/**
 * The full-bleed channel card, from design frame 16h.
 *
 * The photograph *is* the card: it fills the whole thing, and the number and
 * title read on top of it. What it replaced was a small thumbnail sitting in
 * a bordered box with the text in another box below — boxes inside boxes,
 * with the picture the smallest element on a card that is entirely about a
 * picture.
 *
 * **One card, two homes** (M65). The overview shows a horizontal strip of
 * fixed 150×200 cards; the Shelf tab shows a full-width grid two across. Same
 * card, laid out for its own container — so the caller owns the width and
 * this owns the shape, the scrim, the badges and the type. It was written
 * inside the overview first and lifted out the moment a second caller
 * appeared, because two copies of one card drift and the drift gets reported
 * as a bug.
 */
export function ShelfCardFull({
  channel,
  live,
  locked = false,
  onPress,
  className = "",
}: {
  channel: Channel;
  /** The channel actually on her screen right now. */
  live?: boolean;
  /** Somebody else's channel, which this person may not edit (M49). */
  locked?: boolean;
  onPress: () => void;
  /** The caller decides the footprint: a fixed strip size, or a grid cell. */
  className?: string;
}) {
  const number = String(channel.number).padStart(2, "0");

  return (
    <button
      type="button"
      onClick={onPress}
      className={`relative overflow-hidden rounded-card text-left ${className}`}
      style={{ background: "rgba(var(--ink),.06)" }}
    >
      {channel.cover_url && (
        <img
          src={thumb(channel.cover_url, 640)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/*
        The scrim is what makes white text safe on a photograph nobody has
        seen yet — a bright sky at the foot of the card would otherwise take
        the title with it. One of the two literals frame 16h specifies.
      */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,.82) 0%, rgba(0,0,0,.25) 45%, transparent 65%)",
        }}
      />

      {/* Two marks, two corners, never the same edge (M59). */}
      {live && (
        <span
          className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9px] tracking-[0.14em] text-white"
          style={{ background: "rgba(var(--accent-channels),.92)" }}
        >
          <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-white" />
          LIVE
        </span>
      )}

      {locked && (
        <span
          title="Only the person who created this can add to it"
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full"
          style={{ background: "rgba(0,0,0,.5)", color: "rgba(var(--ink),.7)" }}
        >
          <Lock className="h-3 w-3" aria-hidden />
          <span className="sr-only">You cannot add to this channel</span>
        </span>
      )}

      <span className="absolute inset-x-[14px] bottom-[13px]">
        <span className="block text-[15px] font-bold italic leading-none text-[color:rgba(var(--ink),0.65)]">
          {number}
        </span>
        <span className="mt-1 block truncate text-[15px] font-medium leading-[1.25] text-white">
          {channel.title}
        </span>
      </span>
    </button>
  );
}

/**
 * The tile that starts a new channel, in the same footprint as a real card so
 * a row or grid stays even.
 */
export function NewChannelCard({
  onPress,
  className = "",
}: {
  onPress: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex flex-col items-center justify-center rounded-card border border-dashed ${className}`}
      style={{ borderColor: "rgba(var(--ink),.25)" }}
    >
      <span className="text-[26px] font-light text-[color:rgba(var(--ink),0.5)]">+</span>
      <span className="mt-1 text-[11px] text-fg-faint">New channel</span>
    </button>
  );
}
