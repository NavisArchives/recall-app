import { useCallback, useEffect, useRef, useState } from "react";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";
import { fromTop, px } from "@/lib/designSpace";
import { ChannelIntro, eyebrow } from "@/components/display/ChannelIntro";
import { ContributorChip } from "@/components/display/ContributorChip";
import type { ChannelWithMedia, MediaFile } from "@/types";

/**
 * A film — display spec 24d, the reference screen for the whole set.
 *
 * Design space is 1440×810, so every measurement here is the mockup's own
 * pixels put through `px / 14.4 = vw`. Vertical sizes are in vw too, on
 * purpose: it keeps the proportions exact on any 16:9 panel instead of
 * letting the layout stretch with the aspect ratio.
 *
 * ── Why the controls are this bare ───────────────────────────────────────
 *
 * Play and pause, and nothing else. No scrubbing, no fifteen-second skips,
 * no volume, no native control bar. She has a remote with arrows and OK, and
 * every extra control is one more thing to be wrong about — a scrub bar on a
 * television is a way to lose your place, not a way to find it. The progress
 * bar is there to be read, never to be dragged.
 *
 * The ring fades out after two seconds of playing and comes back on any
 * keypress, so the picture is not permanently covered by a button, and
 * nothing is ever hidden that she cannot bring back by pressing something.
 */

const CREAM = "#F2F1EE";
const ACCENT = "#C87941";

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoScreen({ channel }: { channel: ChannelWithMedia }) {
  const { setBackdrop, setBackdropVideo, setStatus } = useDisplay();
  const video = useRef<HTMLVideoElement>(null);

  const film: MediaFile | undefined =
    channel.media.find((m) => m.file_type === "video") ?? channel.media[0];
  const poster = channel.media.find((m) => m.file_type === "image")?.url ?? channel.cover_url ?? null;

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ringVisible, setRingVisible] = useState(true);

  /*
    The room behind the television, painted by the shell — the same wall
    every other screen uses (`.recall-backdrop`: fixed, inset −40px, behind
    the header).

    This screen used to paint its own layers inside the page, which stopped
    at the header: a coloured room under a black band, on the one screen
    that has colour to give. A film rarely carries a poster image, so when
    there is none the film itself becomes the wall.
  */
  useEffect(() => {
    if (poster) setBackdrop(poster);
    else if (film?.url) setBackdropVideo(film.url);
    return () => {
      setBackdrop(null);
      setBackdropVideo(null);
    };
  }, [poster, film?.url, setBackdrop, setBackdropVideo]);

  /*
    The header's right column, and what it must NOT say (spec 24).

    A film is one thing, so `1 OF 1` answers a question nobody asked and
    implies somewhere else to go; and "use the arrows for the next photo" is
    about photographs, which this is not. The verb is the hint.
  */
  useEffect(() => {
    setStatus({ hint: "OK to play or pause" });
    return () => setStatus(null);
  }, [setStatus]);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    setRingVisible(true);
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, []);

  // OK toggles. The arrows do nothing here — there is nowhere to go inside
  // one film, and a key that silently does nothing is better than one that
  // jumps her out of what she is watching.
  useRemoteKeys({ onSelect: toggle });

  // Any keypress brings the ring back, so nothing is hidden irrecoverably.
  useEffect(() => {
    const show = () => setRingVisible(true);
    window.addEventListener("keydown", show);
    return () => window.removeEventListener("keydown", show);
  }, []);

  // Two seconds after playing starts, the ring gets out of the way.
  useEffect(() => {
    if (!playing || !ringVisible) return;
    const id = setTimeout(() => setRingVisible(false), 2000);
    return () => clearTimeout(id);
  }, [playing, ringVisible]);

  const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;

  return (
    <div className="relative h-full overflow-hidden">
      {/* ── The words. Left 56, top 262, width 29% (spec). ────────────── */}
      <div className="absolute" style={{ left: px(56), top: fromTop(262), width: "29%" }}>
        <ChannelIntro
          eyebrow={eyebrow("A FILM", channel.date ?? null)}
          title={channel.title}
          titleSize={48}
          description={channel.description}
        />
      </div>

      {/* One fixed place on every type (owner-directed). */}
      <ContributorChip author={channel.author} />

      {/* ── The film. 39% → right, y 238 to bottom−116 (spec). ─────────── */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: "39%",
          right: px(56),
          top: fromTop(238),
          bottom: px(116),
          borderRadius: px(18),
          boxShadow: "0 24px 70px rgba(0,0,0,.5)",
        }}
      >
        {film?.url ? (
          <video
            ref={video}
            src={film.url}
            poster={poster ?? undefined}
            className="h-full w-full object-cover"
            playsInline
            // No `controls`: the remote is the control surface, and a native
            // bar would offer scrubbing this screen deliberately does not.
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onEnded={() => {
              setPlaying(false);
              setRingVisible(true);
            }}
          />
        ) : (
          poster && <img src={poster} alt="" className="h-full w-full object-cover" />
        )}

        {/* The one control. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute inset-0 flex items-center justify-center"
          style={{
            opacity: ringVisible ? 1 : 0,
            transition: "opacity 400ms ease",
          }}
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{
              width: px(104),
              height: px(104),
              background: "rgba(11,11,12,.55)",
              border: `${px(2)} solid rgba(242,241,238,.85)`,
            }}
          >
            {playing ? (
              // Pause: two bars, 8px wide in the design space.
              <span className="flex" style={{ gap: px(10) }}>
                <span style={{ width: px(8), height: px(34), background: CREAM }} />
                <span style={{ width: px(8), height: px(34), background: CREAM }} />
              </span>
            ) : (
              // Play: a cream triangle, nudged right so it looks centred.
              <span
                style={{
                  marginLeft: px(8),
                  width: 0,
                  height: 0,
                  borderTop: `${px(18)} solid transparent`,
                  borderBottom: `${px(18)} solid transparent`,
                  borderLeft: `${px(28)} solid ${CREAM}`,
                }}
              />
            )}
          </span>
        </button>

        {/* Progress — to be read, never dragged. */}
        <div
          className="absolute flex items-center"
          style={{ left: px(24), right: px(24), bottom: px(20), gap: px(16) }}
        >
          <span
            className="flex-1 overflow-hidden"
            style={{ height: px(6), borderRadius: px(3), background: "rgba(242,241,238,.25)" }}
          >
            <span
              className="block h-full"
              style={{ width: `${progress * 100}%`, background: ACCENT }}
            />
          </span>
          <span
            className="flex-none font-mono"
            style={{ fontSize: px(16), color: "rgba(242,241,238,.8)" }}
          >
            {clock(elapsed)} / {clock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}
