import { useEffect, useRef, useState } from "react";
import { thumb } from "@/lib/thumb";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";
import { fromTop, px } from "@/lib/designSpace";
import type { Channel } from "@/types";

/**
 * Channel 00 — every channel, to display spec 24c.
 *
 * Every size here is the spec's design pixels over 14.4, its 1440-wide
 * space, so the screen reproduces the mockup at 16:9 and scales with the
 * television rather than assuming one. `px / 14.4 = vw`.
 *
 * ── What changed from the shelf this replaces ────────────────────────────
 *
 * **The row slides; the ring stays near the middle.** It used to scroll the
 * focused card into view, which moves the *ring* across the screen and makes
 * the eye chase it. Now the selection sits still and the shelf moves under
 * it, which is what handling a shelf actually feels like.
 *
 * **It wraps at both ends.** The old row clamped, so the last channel was a
 * dead end — she presses the arrow again and nothing happens, which reads as
 * a broken remote rather than as an edge. The list is rendered three times so
 * there is always shelf either side and the wrap has nothing to jump over.
 *
 * **The number is on the photograph.** It reads like the physical card she is
 * holding, which is the whole point of the number.
 *
 * **No backdrop photo.** 24c is the one channel screen with no picture behind
 * it — a radial amber glow on the ground. Borrowing the focused channel's
 * cover made the background flash on every arrow press, and this screen is
 * the one place she is choosing rather than looking.
 */

const CARD_W = 200;
const CARD_H = 280;
const GAP = 26;

/** Lowercase, as the spec writes it: `album`, `a voice message`. */
function typeLabel(contentType: string | null | undefined): string {
  const t = (contentType ?? "").toLowerCase();
  if (t === "video" || t === "documentary") return "a film";
  if (t === "instruction") return "step by step";
  if (t === "stories") return "a story";
  return t || "album";
}

/**
 * Also the "nothing here yet" screen (24g). The owner's merge call, drawn in
 * the frame: there is NO separate screen — typing 85 lands on this same
 * shelf with one extra headline naming the number ("There is nothing on
 * channel 85 yet." — no error language, and *yet* says it could be filled),
 * a 12-second countdown home in quiet mono, and the ordinary route hints in
 * the header. Any arrow press cancels the timer and starts browsing: the
 * moment she engages, this is channel 00 in all but name.
 */
export function Overview({ missingNumber }: { missingNumber?: string } = {}) {
  const navigate = useNavigate();
  const { setBackdrop, setStatus } = useDisplay();
  /*
    `focused` is deliberately UNBOUNDED while she is moving.

    Normalising on every press would make the wrap a full-width slide back
    across the shelf — the one moment that should feel like one more step.
    So it counts freely, the shelf slides one card either way, and the index
    is folded back into range once the movement has finished, with the
    transition suppressed for that one frame so nothing is seen to move.
  */
  const [focused, setFocused] = useState(0);
  const [sliding, setSliding] = useState(true);
  const wheelCooldown = useRef(false);
  /* 24g's countdown. Null once cancelled — engagement, not time, is the only
     thing that cancels it. */
  const [remaining, setRemaining] = useState<number | null>(missingNumber ? 12 : null);

  const { data: channels, isPending: isLoading, isError } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<Channel[]>("/channels"),
  });

  const items = channels ?? [];
  const count = items.length;
  const current = count ? items[((focused % count) + count) % count] : undefined;

  // 24c has no photograph behind it. Whatever the last screen left, clear it.
  useEffect(() => {
    setBackdrop(null);
    return () => setBackdrop(null);
  }, [setBackdrop]);

  /*
    The never-current-screen rule (spec 24): standing on 00, "00 → every
    channel" is an instruction to go where she already is. This screen names
    its own two actions instead.
  */
  useEffect(() => {
    if (!count) return;
    /* On the missing-channel screen the header keeps its default route hints
       (24g draws `00 → every channel · 98 → home · 10 → family`): she typed a
       number that led nowhere, so the honest help is where the numbers go —
       not this screen's own controls. */
    if (missingNumber) return;
    setStatus({ hint: "Arrows to browse · OK to open" });
    return () => setStatus(null);
  }, [count, setStatus, missingNumber]);

  /* The clock home (24g). One interval owns both the tick and the leaving. */
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      navigate("/", { replace: true });
      return;
    }
    const tick = setTimeout(() => setRemaining((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(tick);
  }, [remaining, navigate]);

  function go(delta: number) {
    if (count < 2) return;
    /* An arrow press is engagement: the countdown stops and this becomes
       browsing (24g). Pressing an arrow and being yanked home eleven seconds
       later would teach her the screen cannot be trusted. */
    setRemaining(null);
    setFocused((f) => f + delta);
  }

  function open(channel: Channel | undefined) {
    if (!channel) return;
    navigate(`/channel/${String(channel.number).padStart(2, "0")}`, {
      state: { entry: "overview" },
    });
  }

  useRemoteKeys({
    onPrev: count > 1 ? () => go(-1) : undefined,
    onNext: count > 1 ? () => go(1) : undefined,
    onSelect: current ? () => open(current) : undefined,
  });

  function handleWheel(event: React.WheelEvent) {
    if (wheelCooldown.current || count < 2) return;
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 15) return;
    go(delta > 0 ? 1 : -1);
    wheelCooldown.current = true;
    setTimeout(() => {
      wheelCooldown.current = false;
    }, 300);
  }

  /*
    `isPending`, not `isLoading` (M202, following M191).

    This is one of Margaret's own screens. React Query reports
    `isLoading: false` for a query that is pending but not currently fetching
    — parked between retries — and this guard then falls through to the empty
    branch below, which tells her in large type that her family has not added
    anything. Her whole archive, declared absent, because a request had not
    come back yet.
  */
  if (isLoading) {
    return <p className="flex h-full items-center justify-center text-fg-muted">Loading…</p>;
  }

  if (isError) {
    return (
      <p role="alert" className="flex h-full items-center justify-center text-destructive-soft">
        Your channels could not be loaded.
      </p>
    );
  }

  /*
    Three copies of the shelf, so the wrap has something to slide onto.

    A single list would show empty ground on the left at the first channel and
    on the right at the last — the two moments the wrap exists to remove.
  */
  /** Fold the index home once the slide is over — see `focused` above. */
  function settle() {
    if (!count) return;
    if (focused >= 0 && focused < count) return;
    setSliding(false);
    setFocused((f) => ((f % count) + count) % count);
    // Restore the transition only after the browser has painted the jump.
    requestAnimationFrame(() => requestAnimationFrame(() => setSliding(true)));
  }

  const strip = count ? [...items, ...items, ...items] : [];
  const middle = count; // where the real run starts inside the strip
  const step = CARD_W + GAP;
  // The focused card sits still, centred; the shelf moves under it.
  const offset = `calc(50% - ${px(CARD_W / 2)} - ${px((middle + focused) * step)})`;

  return (
    <div className="relative h-full overflow-hidden" onWheel={handleWheel}>
      {/* 24c's ground: a radial amber glow, no photograph. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(1000px 600px at 40% 60%, rgba(200,121,65,.16), transparent 65%)",
        }}
      />

      {/* Heading block — spec y≈232 in a 810-tall frame, under a 20vh header. */}
      <div className="absolute" style={{ left: px(56), top: fromTop(232) }}>
        {!missingNumber && (
          <p
            className="font-mono uppercase"
            style={{ fontSize: px(12), letterSpacing: ".26em", color: "rgba(242,241,238,.55)" }}
          >
            {count ? "Every channel" : "Nothing here yet"}
          </p>
        )}
        <p
          style={{
            font: `300 ${px(42)}/1.15 Roboto, sans-serif`,
            color: "#F2F1EE",
            marginTop: missingNumber ? 0 : px(14),
          }}
        >
          {missingNumber
            ? `There is nothing on channel ${missingNumber.padStart(2, "0")} yet.`
            : count
              ? "What would you like to see?"
              : "Your family will add some soon."}
        </p>
        {count > 0 && (
          <p
            style={{
              font: `300 ${px(19)}/1.4 Roboto, sans-serif`,
              color: "rgba(242,241,238,.55)",
              marginTop: px(10),
            }}
          >
            {missingNumber
              ? "Here are your channels — type a number, or use the arrows."
              : "Type a number, or use the arrows."}
          </p>
        )}
      </div>

      {count > 0 && (
        <>
          {/* The shelf — spec y≈376. */}
          <div className="absolute left-0 right-0 overflow-hidden" style={{ top: fromTop(376) }}>
            <div
              className="flex items-start"
              onTransitionEnd={settle}
              style={{
                gap: px(GAP),
                transform: `translateX(${offset})`,
                transition: sliding ? "transform 320ms cubic-bezier(.22,.61,.36,1)" : "none",
              }}
            >
              {strip.map((channel, i) => {
                // Exactly the card under the ring — the other two copies of
                // the same channel are scenery, not the selection.
                const selected = i === middle + focused;
                return (
                  <button
                    key={`${channel.id}-${i}`}
                    type="button"
                    onClick={() => open(channel)}
                    className="flex flex-none flex-col text-left"
                    style={{ width: px(CARD_W) }}
                  >
                    <span
                      className="relative block overflow-hidden"
                      style={{
                        height: px(CARD_H),
                        borderRadius: px(16),
                        /* Literal pixels: px(3) is 0.208vw = 2.995px, and
                           Chrome renders the outline at 2.5 — thinner than
                           the spec on the one amber element (same fix as the
                           family slider's ring). Hairlines do not scale. */
                        outline: selected ? "3px solid #C87941" : "none",
                        outlineOffset: "3px",
                        boxShadow: selected ? "0 18px 50px rgba(0,0,0,.55)" : "none",
                        // A channel that exists with nothing to show yet keeps
                        // the frame and says so with a dashed edge (24c).
                        border: channel.cover_url
                          ? "none"
                          : `1px dashed rgba(242,241,238,.25)`,
                      }}
                    >
                      {channel.cover_url && (
                        <img src={thumb(channel.cover_url, 640)} alt="" className="h-full w-full object-cover" />
                      )}
                      {/* The scrim the number sits on. */}
                      <span
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(200deg, transparent 46%, rgba(11,11,12,.72))",
                        }}
                      />
                      {/* The number is ON the photograph — it reads like the
                          physical card she is holding. */}
                      <span
                        className="absolute"
                        style={{
                          left: px(16),
                          bottom: px(12),
                          /*
                          The `italic` in the CSS `font:` shorthand, not only
                          in the class. The shorthand RESETS every property it
                          does not name — font-style included — and an inline
                          style beats a utility class, so `className="italic"`
                          beside `font: 400 …` computes to upright. It looked
                          right in the markup and was wrong on all 28 cards.
                        */
                        font: `italic 400 ${px(34)}/1 Roboto, sans-serif`,
                          color: selected ? "#E29A68" : "#F2F1EE",
                        }}
                      >
                        {String(channel.number).padStart(2, "0")}
                      </span>
                    </span>

                    <span
                      className="block"
                      style={{
                        marginTop: px(14),
                        font: `400 ${px(16)}/1.3 Roboto, sans-serif`,
                        color: selected ? "#E29A68" : "rgba(242,241,238,.8)",
                      }}
                    >
                      {channel.title}
                    </span>
                    <span
                      className="block lowercase"
                      style={{
                        marginTop: px(4),
                        font: `italic 300 ${px(13)}/1.3 Roboto, sans-serif`,
                        color: "rgba(242,241,238,.5)",
                      }}
                    >
                      {typeLabel(channel.content_type)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/*
            The fade at the right edge: the shelf continues past it. It wraps,
            so there is no true end and the fade never has to disappear.
          */}
          <div
            className="pointer-events-none absolute bottom-0 right-0 top-0"
            style={{
              width: px(120),
              background: "linear-gradient(to right, transparent, #0B0B0C)",
            }}
          />
        </>
      )}

      {/* 24g's countdown, quiet mono, centred near the floor. Gone the moment
          she engages — see go(). */}
      {remaining !== null && (
        <p
          aria-live="polite"
          className="absolute left-0 right-0 text-center font-mono uppercase"
          style={{
            bottom: px(40),
            fontSize: px(13),
            letterSpacing: ".2em",
            color: "rgba(242,241,238,.4)",
          }}
        >
          Back home in {Math.max(remaining, 0)} seconds
        </p>
      )}
    </div>
  );
}
