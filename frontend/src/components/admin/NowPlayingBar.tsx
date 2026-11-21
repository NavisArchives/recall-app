import { useNavigate } from "react-router-dom";
import { ImageIcon } from "lucide-react";
import { useDisplay } from "@/lib/DisplayContext";
import { useChannels, useScreenState } from "@/hooks/useAdminData";

/**
 * "ON MARGARET'S SCREEN NOW" — the bar the ask screens keep at their foot
 * (frames 8a/8c).
 *
 * Its whole reason to exist is reassurance: asking the archive never touches
 * her screen, and the bar proves it by showing what the screen is doing the
 * entire time. So it renders only while the display is genuinely live —
 * a dark screen would make the bar a claim about nothing, and the frames
 * draw no dark state for it.
 *
 * "photo {n} of {m}" and the dot strip come from the display's own position
 * report (040). When the display has not reported a position — an older
 * build, a channel with nothing to page through — the meta line simply
 * holds channel facts and the dots do not render. Silence, not a guess.
 */
export function NowPlayingBar() {
  const navigate = useNavigate();
  const { subjectName } = useDisplay();
  const { data: screen } = useScreenState();
  const { data: channels } = useChannels();

  if (!screen?.live || screen.current_channel_number === null) return null;

  const channel = (channels ?? []).find((c) => c.number === screen.current_channel_number);
  const number = String(screen.current_channel_number).padStart(2, "0");
  const subject = (subjectName?.trim() || "the family").toUpperCase();

  const hasPosition = screen.photo_index !== null && screen.photo_count !== null;
  const since = screen.screen_synced_at
    ? new Date(screen.screen_synced_at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const meta = [
    channel?.content_type ?? "channel",
    hasPosition ? `photo ${screen.photo_index! + 1} of ${screen.photo_count}` : null,
    since ? `since ${since}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  /*
    The dot strip mirrors the count only while it stays readable as dots.
    A forty-photo album would render a strip of noise; the frames draw nine,
    and past ~15 the strip says less than the words already do.
  */
  const dots = hasPosition && screen.photo_count! <= 15;

  return (
    <div
      className="flex w-full flex-none items-center gap-5 rounded-[26px] p-[14px_22px_14px_14px]"
      style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
    >
      <span
        className="flex h-16 w-[88px] flex-none items-center justify-center overflow-hidden rounded-[16px]"
        style={{ border: "1px solid rgba(var(--ink),.1)", background: "var(--panel-deep)" }}
      >
        {channel?.cover_url ? (
          <img src={channel.cover_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon size={18} style={{ color: "rgba(var(--ink-cream),.35)" }} aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: "var(--live-amber)" }} />
          <span
            className="font-mono text-[9px] font-medium tracking-[0.16em]"
            style={{ color: "var(--live-amber)" }}
          >
            ON {subject}'S SCREEN NOW
          </span>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
          <span
            className="flex-none rounded-[8px] px-2 py-1.5 font-mono text-[11px] font-medium leading-none"
            style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}
          >
            {number}
          </span>
          <span
            className="truncate text-[18px] font-semibold"
            style={{ color: "var(--cream)", letterSpacing: "-.015em" }}
          >
            {channel?.title ?? "On screen"}
          </span>
        </div>
        <div className="mt-1 text-[12px]" style={{ color: "rgba(var(--ink-cream),.7)" }}>
          {meta}
        </div>
      </div>

      {dots && (
        <div className="flex flex-none items-center gap-[6px]" aria-hidden>
          {Array.from({ length: screen.photo_count! }, (_, i) => (
            <span
              key={i}
              className="rounded-full"
              style={
                i === screen.photo_index
                  ? { width: 26, height: 7, background: "var(--live-amber)" }
                  : {
                      width: 7,
                      height: 7,
                      background:
                        i < screen.photo_index! ? "var(--fg-dim)" : "rgba(var(--ink),.16)",
                    }
              }
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => navigate("/admin/shelf")}
        className="flex-none rounded-full px-[18px] py-[11px] text-[12px] font-medium leading-none"
        style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
      >
        Change channel
      </button>
    </div>
  );
}
