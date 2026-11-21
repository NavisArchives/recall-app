import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";
import { px, fromTop } from "@/lib/designSpace";
import type { Author } from "@/types";

/**
 * The people in her life — spec 24f.
 *
 * The grid of small circles became a slider: one person in focus at 350×460
 * with the amber ring, neighbours dimmed at the edges, the next one bleeding
 * off the right. That is deliberately the album's movement (24e) rather than
 * a new one — the arrows slide the row and the selection stays near the
 * middle, so she never has to learn a second gesture for a second screen.
 *
 * The left column speaks like family rather than like a directory: her
 * daughter's name at 66px, `Your daughter` beneath it — the relationship is
 * always addressed TO her, never stated in the abstract — and one warm
 * sentence from that person's own profile.
 *
 * **Never an email or a phone number on this screen.** The public people
 * route does not carry them, which is the real guarantee; this comment is
 * here so that nobody reaches for a richer endpoint to fill the column.
 */

const CREAM = "#F2F1EE";
const MUTED = "rgba(242,241,238,.55)";
const BODY = "rgba(242,241,238,.78)";
const ACCENT = "#C87941";
const ACCENT_TEXT = "#E29A68";

/** `Daughter` → `Your daughter`. Always addressed to her. */
function addressed(relationship: string | null): string | null {
  const r = relationship?.trim();
  if (!r) return null;
  return /^your\b/i.test(r) ? r : `Your ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
}

/** One card in the row. The focused one is bigger, lit, and ringed. */
function Portrait({ person, focused }: { person: Author; focused: boolean }) {
  const w = focused ? 350 : 270;
  const h = focused ? 460 : 360;
  return (
    <div
      className="flex-none overflow-hidden"
      style={{
        width: px(w),
        height: px(h),
        borderRadius: px(18),
        /* The ring is the only amber on the row, and `outline` rather than a
           border so it cannot change the card's size and shuffle the row. */
        /* A literal 3px, not px(3). The ring is a hairline the spec states in
           real pixels, and expressing it in vw lands on 2.995px, which Chrome
           rounds down to 2.5 — a ring visibly thinner than the design asks
           for, on the one element the whole screen points at. */
        outline: focused ? `3px solid ${ACCENT}` : "none",
        outlineOffset: focused ? "4px" : undefined,
        boxShadow: focused ? "0 24px 70px rgba(0,0,0,.55)" : "0 12px 34px rgba(0,0,0,.35)",
        filter: focused ? "none" : "brightness(.55) saturate(.85)",
        background: "rgba(242,241,238,.05)",
        transition: "width .32s ease, height .32s ease, filter .32s ease",
      }}
    >
      {person.profile_picture_url ? (
        <img
          src={person.profile_picture_url}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        /* A person with no photograph yet is still a person on this row: the
           card keeps its size and shows their initial, rather than collapsing
           and making the row jump where a face is missing. */
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center"
          style={{
            font: `300 ${px(96)}/1 Roboto, sans-serif`,
            color: "rgba(242,241,238,.35)",
            border: `${px(1)} dashed rgba(242,241,238,.22)`,
            borderRadius: px(18),
          }}
          data-placeholder="family-portrait"
        >
          {person.name.charAt(0)}
        </span>
      )}
    </div>
  );
}

export function Social() {
  const { setBackdrop, setStatus } = useDisplay();
  const [focused, setFocused] = useState(0);

  const { data: people, isPending, isError } = useQuery({
    queryKey: ["people"],
    queryFn: () => api.get<Author[]>("/people"),
  });

  /*
    Skip the subject herself — this screen is about the people around her —
    and honour the visibility axis (043).

    `!== false` rather than `=== true`: the column defaults to true and an
    older payload may not carry it at all, and the failure a family would
    never forgive is a face vanishing from her screen because a field was
    undefined. Absent means visible.
  */
  const others = (people ?? []).filter(
    (p) => p.role !== "user" && p.show_on_display !== false
  );
  const current = others[focused] ?? others[0];

  /* The focused person's photograph becomes the room behind her, blurred by
     the shared recipe — so sliding the row is like turning towards someone. */
  useEffect(() => {
    const face =
      current?.profile_picture_url ??
      others.find((p) => p.profile_picture_url)?.profile_picture_url ??
      null;
    setBackdrop(face);
    return () => setBackdrop(null);
  }, [current, others, setBackdrop]);

  useEffect(() => {
    if (others.length < 2) return;
    setStatus({
      hint: "Use the arrows for the next person",
      current: focused + 1,
      total: others.length,
    });
    return () => setStatus(null);
  }, [others.length, focused, setStatus]);

  /* Wrapping at both ends, exactly as the album wraps — she can hold one
     arrow down and go round rather than hitting a wall she cannot see. */
  function go(delta: number) {
    if (others.length < 2) return;
    setFocused((i) => (i + delta + others.length) % others.length);
  }

  useRemoteKeys({
    onPrev: others.length > 1 ? () => go(-1) : undefined,
    onNext: others.length > 1 ? () => go(1) : undefined,
  });

  /*
    `isPending`, not `isLoading` (M202, following M191). React Query reports
    `isLoading: false` for a query parked between retries, and this guard
    would then fall through to the empty branch below — telling her in large
    type that her family has not added anything, because a request had not
    come back yet.
  */
  if (isPending) {
    return <p className="flex h-full items-center justify-center text-fg-muted">Loading…</p>;
  }

  if (isError) {
    return (
      <p role="alert" className="flex h-full items-center justify-center text-destructive-soft">
        Your family could not be loaded.
      </p>
    );
  }

  if (others.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="t-title">Nobody here just yet.</p>
        <p className="t-body text-fg-muted">Your family will appear here.</p>
      </div>
    );
  }

  /*
    The row is translated rather than scrolled, so the focused card can sit at
    a fixed place on the screen while everything else moves past it — the same
    thing the shelf on channel 00 does. Cards before the focused one are the
    small size, so the offset is counted in those.
  */
  const SMALL = 270;
  const GAP = 34;
  const shift = focused * (SMALL + GAP);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* ── The words, left ─────────────────────────────────────────── */}
      <div
        className="absolute"
        style={{ left: px(56), top: fromTop(266), width: "31%" }}
      >
        <p
          style={{
            font: `400 ${px(12)}/1 'Roboto Mono', monospace`,
            letterSpacing: ".26em",
            color: MUTED,
            textTransform: "uppercase",
          }}
        >
          The people in your life
        </p>

        <h1
          style={{
            font: `300 ${px(66)}/1.08 Roboto, sans-serif`,
            color: CREAM,
            marginTop: px(18),
          }}
        >
          {current.name}
        </h1>

        {addressed(current.relationship) && (
          <p
            style={{
              /* italic inside the shorthand: `font:` resets font-style, and an
                 inline style outranks a utility class (see Overview.tsx). */
              font: `italic 300 ${px(25)}/1.3 Roboto, sans-serif`,
              color: ACCENT_TEXT,
              marginTop: px(12),
            }}
          >
            {addressed(current.relationship)}
          </p>
        )}

        {current.description && (
          <p
            style={{
              font: `300 ${px(22)}/1.5 Roboto, sans-serif`,
              color: BODY,
              marginTop: px(22),
              maxWidth: "24ch",
              textWrap: "pretty",
            }}
          >
            {current.description}
          </p>
        )}
      </div>

      {/* ── The row, right ──────────────────────────────────────────── */}
      <div
        className="absolute overflow-hidden"
        /*
          The spec's zone is y 212, height 470 — and the focused card is 460
          tall with a 3px ring at 4px offset, so it needs 474. Inside a 470
          box with `overflow:hidden` (which the right-hand bleed requires) the
          ring was sliced off along the top and bottom edges.

          So the BOX grows by the ring on each side and starts that much
          earlier; the cards are centred in it, which puts the card itself
          back at exactly y 217 where a 460 card centred in the spec's 470
          box would sit. The design is unchanged — only the clip is.
        */
        style={{
          left: "40%",
          right: 0,
          top: fromTop(212 - 7),
          height: px(470 + 14),
          /*
            The right-edge fade is a MASK on the row, not a painted gradient
            over it. The first version laid `transparent → #0B0B0C` on top,
            which is right on channel 00's flat ground and wrong here: this
            screen's background is the focused person's photograph, warm and
            light, and a strip of painted near-black over it reads as a black
            bar. A mask fades the cards themselves to nothing, and whatever
            the room behind them is shows through.
          */
          WebkitMaskImage: `linear-gradient(90deg, black calc(100% - ${px(110)}), transparent)`,
          maskImage: `linear-gradient(90deg, black calc(100% - ${px(110)}), transparent)`,
        }}
      >
        <div
          className="flex items-center"
          style={{
            height: "100%",
            gap: px(GAP),
            /* The ring again, left edge this time: the focused card starts at
               x=0 of the clip box, and its 3px ring at 4px offset lives at
               x=-7 — sliced. The row starts 8px in, so the ring has room; the
               translate is unaffected because the padding is constant. */
            paddingLeft: "8px",
            transform: `translateX(calc(${px(-shift)}))`,
            transition: "transform .32s ease",
          }}
        >
          {others.map((person, i) => (
            <Portrait key={person.id} person={person} focused={i === focused} />
          ))}
        </div>

      </div>

      {/* ── The dots ────────────────────────────────────────────────── */}
      {others.length > 1 && (
        <div
          className="absolute flex items-center justify-center"
          /*
            `top`, not `bottom`. `fromTop(y)` converts a frame-y into an offset
            measured DOWN from the top of the page area — feeding it to
            `bottom` measures the same number up from the floor and lands the
            dots at the top of the screen, sitting on the row (N2 hit the same
            trap on the contributor chip). Frame-y goes to `top`, always.
          */
          style={{ left: "40%", right: px(110), top: fromTop(716), gap: px(10) }}
        >
          {others.map((person, i) => (
            <span
              key={person.id}
              style={{
                width: px(9),
                height: px(9),
                borderRadius: "50%",
                background: i === focused ? ACCENT : "rgba(242,241,238,.25)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
