import { Link } from "react-router-dom";
import { ImageIcon, Lock } from "lucide-react";
import type { Channel } from "@/types";

export type ScreenBadge = "live" | "last" | null;

/**
 * A channel as it sits on the shelf: a small screen in a wooden set, with
 * its number and title beneath. The set that is playing right now wears an
 * amber frame; when her screen has been quiet a while, the frame moves to
 * the memory she came back to last, so the shelf is never dead.
 */
export function ShelfCard({
  channel,
  badge = null,
  canEdit,
  onOpen,
}: {
  channel: Channel;
  badge?: ScreenBadge;
  canEdit: boolean;
  onOpen?: () => void;
}) {
  const number = String(channel.number).padStart(2, "0");
  const live = badge === "live";

  const media = [
    channel.photo_count ? `${channel.photo_count} photo${channel.photo_count > 1 ? "s" : ""}` : "",
    channel.video_count ? `${channel.video_count} video${channel.video_count > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  /*
   * Every card at full strength, whoever is looking.
   *
   * This used to render a channel you cannot edit at 35% opacity, which made
   * a co-author's shelf look broken — as though the covers had failed to
   * load — and hid the photographs from the very person invited to enjoy
   * them. Whether Anne may edit "Summer in Brittany" is a fact about the
   * editor, not about the shelf. The lock mark says it quietly; the cover
   * says everything else.
   */
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        className="pressable relative block w-full rounded-xl text-left"
        style={{
          border: live ? "2px solid var(--live)" : "1px solid rgba(var(--ink),.22)",
          borderRadius: 12,
          background: live ? "var(--panel-menu-live)" : "var(--panel-menu)",
          boxShadow: "var(--shadow-tile), inset 0 1px 0 rgba(var(--ink),.14)",
          cursor: "pointer",
        }}
      >
        <span
          className="relative block aspect-[4/5.1] overflow-hidden"
          style={{ borderRadius: "9px 9px 0 0" }}
        >
          {channel.cover_url ? (
            <img src={channel.cover_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[rgba(var(--ink),0.04)]">
              <ImageIcon className="h-8 w-8 text-fg-faint" aria-hidden />
            </span>
          )}

          {!canEdit && (
            <span
              title="Only its author and the admins can change this"
              className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full"
              style={{ background: "rgba(0,0,0,.6)", color: "rgba(255,255,255,.75)" }}
            >
              <Lock className="h-3 w-3" aria-hidden />
              <span className="sr-only">You cannot edit this channel</span>
            </span>
          )}

          {/*
            The screen badge sits at the foot of the cover, on the card's own
            screen-like base — it is about the screen, so it belongs there —
            and the lock keeps the top-right corner to itself. Role marks and
            screen marks stopped sharing an edge (M59); before this, a live
            channel somebody could not edit wore both in the same strip.
          */}
          {badge && (
            <span
              className="absolute bottom-2 left-2 rounded-full px-2.5 py-1 font-mono text-[10px] tracking-[0.1em]"
              style={
                live
                  ? { background: "var(--live)", color: "#08130c" }
                  : {
                      background: "rgba(0,0,0,.65)",
                      // Over a photograph, so it stays light in every theme rather
                      // than following the accent down to a readable-on-paper
                      // depth. This is the dark theme's own --accent-soft.
                      color: "oklch(0.78 0.1 55)",
                      border: "1px solid var(--accent)",
                    }
              }
            >
              {live ? "ON SCREEN" : "LAST WATCHED"}
            </span>
          )}

        </span>

        {/* The set's base — what makes a photograph read as a screen. */}
        <span
          className="block h-3"
          style={{
            borderRadius: "0 0 9px 9px",
            background: live
              ? "linear-gradient(180deg,var(--shelf-live-top),var(--shelf-live-bottom))"
              : "linear-gradient(180deg,var(--shelf-top),var(--shelf-bottom))",
            borderTop: "1px solid rgba(var(--ink),.07)",
          }}
        />
      </button>

      <div className="mt-2.5 flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-light italic" style={{ fontSize: 22 }}>
          {number}
        </span>
        <span className="min-w-0 flex-1 truncate text-[16px]">{channel.title}</span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-fg-faint">
        {media || channel.content_type}
      </p>
    </div>
  );
}

/** The last tile on the shelf: an empty set waiting for a memory. */
export function NewChannelCard() {
  return (
    <Link
      to="/admin/create-channel"
      className="pressable flex flex-col items-center justify-center gap-2 rounded-xl"
      style={{
        border: "1px dashed rgba(var(--ink),.3)",
        aspectRatio: "4 / 5.4",
      }}
    >
      <span className="text-3xl font-light text-fg-faint">+</span>
      <span className="text-[13px] text-fg-muted">New channel</span>
    </Link>
  );
}
