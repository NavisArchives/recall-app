import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";
import { px, fromTop } from "@/lib/designSpace";
import { ChannelIntro, eyebrow } from "@/components/display/ChannelIntro";
import { ContributorChip } from "@/components/display/ContributorChip";
import type { ChannelWithMedia } from "@/types";

/**
 * A voice message — spec 24b (the `stories` type, 051).
 *
 * The message's photograph is the room (the shared blurred recipe); the
 * words column carries the title and "Odette is talking to you." — the one
 * amber line, because on this screen the person speaking is the thing that
 * matters. On the right, a waveform fills bar by bar as the voice plays.
 *
 * No transcript, deliberately: this screen is for listening, and text beside
 * a voice invites reading instead. OK toggles pause. When it ends the screen
 * says nothing, waits ~10s of stillness, and takes her home — a message that
 * has finished should not need her to do anything about it.
 */

const BAR_COUNT = 44;
const ACCENT = "#C87941";

/**
 * The waveform's heights: 22–78px, organic, and STABLE for a given file.
 *
 * Derived from the audio url's characters rather than Math.random, so the
 * same message always draws the same shape — a wave that reshuffled on every
 * visit would quietly say "this is decoration", and it is meant to read as
 * the voice itself.
 */
function heightsFor(seed: string): number[] {
  let h = 2166136261;
  const step = () => {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967295;
  };
  for (const c of seed) h = (h ^ c.charCodeAt(0)) * 16777619;
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    // A gentle envelope so the middle of the message reads louder than the
    // edges — the shape a real voice tends to have.
    const envelope = 0.55 + 0.45 * Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    return Math.round(22 + (78 - 22) * envelope * (0.45 + 0.55 * step()));
  });
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function StoriesScreen({ channel }: { channel: ChannelWithMedia }) {
  const navigate = useNavigate();
  const { setBackdrop, setStatus } = useDisplay();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ended, setEnded] = useState(false);

  const photo = channel.media.find((m) => m.file_type === "image") ?? null;
  const voice = channel.media.find((m) => m.file_type === "audio") ?? null;
  const bars = useMemo(() => heightsFor(voice?.url ?? channel.id), [voice?.url, channel.id]);

  /* The photograph is the room. A message with no photo yet keeps the warm
     wash the backdrop already falls back to. */
  useEffect(() => {
    setBackdrop(photo?.url ?? null);
    return () => setBackdrop(null);
  }, [photo?.url, setBackdrop]);

  /* Single item: the OK verb, never the photo hint, never a counter (the
     header suppresses totals of one on its own — this sets none at all). */
  useEffect(() => {
    setStatus({ hint: "OK to play or pause" });
    return () => setStatus(null);
  }, [setStatus]);

  /* When it ends: stillness, then home (spec: return to 98 after ~10s). Any
     key press during the wait is engagement and cancels it — she may be
     reaching for the arrows to hear it again. */
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => navigate("/", { replace: true }), 10_000);
    const cancel = () => {
      clearTimeout(t);
      setEnded(false);
    };
    window.addEventListener("keydown", cancel);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", cancel);
    };
  }, [ended, navigate]);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }

  useRemoteKeys({ onSelect: voice ? toggle : undefined });

  const firstName = channel.author?.name.trim().split(/\s+/)[0] ?? null;
  const playedBars = duration > 0 ? Math.round((elapsed / duration) * BAR_COUNT) : 0;

  return (
    <div className="relative h-full min-h-0">
      {/* ── The words, left (56px, y≈262, 33%) ────────────────────────── */}
      <div className="absolute" style={{ left: px(56), top: fromTop(262), width: "33%" }}>
        <ChannelIntro
          eyebrow={eyebrow("A story", channel.date)}
          title={channel.title}
          titleSize={54}
          accent={firstName ? `${firstName} is talking to you.` : null}
          description={channel.description}
          descriptionSize={20}
        />
      </div>

      <ContributorChip author={channel.author} />

      {/* ── The waveform, right (43% → right, centred) ────────────────── */}
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ left: "43%", right: px(56), top: 0, bottom: 0 }}
      >
        {voice ? (
          <>
            <div className="flex items-end" style={{ gap: px(5), height: px(78) }}>
              {bars.map((h, i) => (
                <span
                  key={i}
                  style={{
                    width: px(9),
                    height: px(h),
                    borderRadius: px(4.5),
                    background: i < playedBars ? ACCENT : "rgba(242,241,238,.22)",
                    transition: "background .2s linear",
                  }}
                />
              ))}
            </div>
            <p
              className="font-mono"
              style={{
                marginTop: px(26),
                fontSize: px(15),
                letterSpacing: ".2em",
                color: "#E29A68",
              }}
            >
              {clock(elapsed)} / {clock(duration)}
            </p>
            <audio
              ref={audioRef}
              src={voice.url ?? undefined}
              onPlay={() => {
                setPlaying(true);
                setEnded(false);
              }}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
              onDurationChange={(e) => setDuration(e.currentTarget.duration)}
              onEnded={() => setEnded(true)}
            />
            {!playing && (
              /* The resting invitation — quiet, because OK is on the remote
                 and the hint is in the header. */
              <p
                className="font-mono uppercase"
                style={{
                  marginTop: px(18),
                  fontSize: px(12),
                  letterSpacing: ".2em",
                  color: "rgba(242,241,238,.45)",
                }}
              >
                {ended ? "It has finished" : elapsed > 0 ? "Paused" : "Press OK to listen"}
              </p>
            )}
          </>
        ) : (
          /* Drawn but not fed: the voice has not arrived yet. Absence stated,
             never an error — the family may be about to record it. */
          <p
            className="max-w-[26ch] text-center"
            style={{ font: `300 ${px(20)}/1.5 Roboto, sans-serif`, color: "rgba(242,241,238,.6)" }}
            data-placeholder="stories-voice"
          >
            The voice message has not been added yet.
          </p>
        )}
      </div>

      {/* ── The promise at the floor ──────────────────────────────────── */}
      {voice && (
        <p
          className="absolute left-0 right-0 text-center font-mono uppercase"
          style={{
            bottom: px(44),
            fontSize: px(13),
            letterSpacing: ".2em",
            color: "rgba(242,241,238,.4)",
          }}
        >
          Back home when it ends
        </p>
      )}
    </div>
  );
}
