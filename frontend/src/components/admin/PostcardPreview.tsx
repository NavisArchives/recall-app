import { useEffect, useRef, useState } from "react";
import type { NfcCard } from "@/hooks/useAdminData";

/**
 * The card itself — front and back, at print proportion (design 18d).
 *
 * This is the object the whole flow exists for, so it is drawn as an object
 * rather than as an interface. It wears the printed identity, not the
 * workspace's tokens: aged stock, Archivo for the number, Cormorant Garamond
 * italic for the title, and the vermillion that belongs to Recall. A card
 * that changed colour with dark mode would be lying about what arrives
 * through the door.
 *
 * The pair is the chosen one — front 22a (the mat: photograph high, number
 * and title beneath it) and back 23a (the bookplate: a stamp, a rule, and the
 * one sentence the channel already knows).
 *
 * Every line is PULLED, never typed. The number, title and description come
 * from the channel; the two names from people. That is the brief's rule —
 * the channel is the source of truth — so correcting a channel's title
 * corrects every card that opens it, including ones already posted.
 *
 * No QR code, no instructions, no medical language: 18d is explicit, and the
 * reason is that this lands in a living room rather than a waiting room.
 */

const STOCK = "#EFE8D6";
const INK = "#14130F";
const VERMILLION = "#C13B22";
const STAMP = "#A93429";

/** The printer's proportion; everything else is a fraction of it. */
const W = 620;
const H = 440;

const shell = (scale: number) => ({
  width: W * scale,
  height: H * scale,
  borderRadius: 8 * scale,
  background: STOCK,
  boxShadow: `0 ${12 * scale}px ${36 * scale}px rgba(0,0,0,.22), inset 0 0 ${60 * scale}px rgba(120,100,60,.09)`,
  boxSizing: "border-box" as const,
  position: "relative" as const,
  flex: "none" as const,
  overflow: "hidden" as const,
});

/**
 * 22h — the corners (the owner's pick, superseding 22a's band).
 *
 * The photograph fills the mat edge to edge inside an even ivory border; the
 * title sits ON it, top-left, 30px/700 caps in aged ivory; the number stands
 * alone bottom-right at 62px. No dot, no wordmark, no band — the photograph
 * is the card, and the two pieces of type live in its quiet corners.
 *
 * Every measurement is the frame's, in its 620×440 units; `scale` is the
 * only thing that ever changes.
 */
export function PostcardFront({ card, scale = 1 }: { card: NfcCard; scale?: number }) {
  const n = card.channel?.number;
  const number = typeof n === "number" ? String(n).padStart(2, "0") : "--";
  const photo = card.photo?.url ?? null;
  const IVORY = "rgba(239,232,214,.94)";

  return (
    <div style={shell(scale)}>
      <div
        style={{
          position: "absolute",
          inset: 18 * scale,
          overflow: "hidden",
          background: "rgba(20,19,15,.06)",
        }}
      >
        {photo ? (
          <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          /* A card with no photograph yet is not an error and does not pretend
             to be one — 18c is where one is chosen. */
          <div
            className="flex h-full w-full items-center justify-center"
            style={{ font: `400 ${12 * scale}px/1 Archivo, sans-serif`, color: "rgba(20,19,15,.4)" }}
            data-placeholder="postcard-front-photo"
          >
            No photograph chosen yet
          </div>
        )}

        {photo && (
          <>
            {/* The type needs a whisper of ground on a bright photograph —
                two soft corner scrims, nothing like a band. */}
            <span
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(160deg, rgba(20,19,15,.28), transparent 34%), " +
                  "linear-gradient(320deg, rgba(20,19,15,.3), transparent 32%)",
              }}
            />
            <span
              style={{
                position: "absolute",
                left: 26 * scale,
                top: 20 * scale,
                right: 26 * scale,
                font: `700 ${30 * scale}px/1.15 Archivo, sans-serif`,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: IVORY,
                textShadow: "0 1px 8px rgba(20,19,15,.25)",
              }}
            >
              {card.channel?.title ?? ""}
            </span>
            <span
              style={{
                position: "absolute",
                right: 26 * scale,
                bottom: 12 * scale,
                font: `700 ${62 * scale}px/1 Archivo, sans-serif`,
                letterSpacing: "-.01em",
                color: IVORY,
                textShadow: "0 1px 8px rgba(20,19,15,.25)",
              }}
            >
              {number}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function PostcardBack({ card, scale = 1 }: { card: NfcCard; scale?: number }) {
  const sender = card.sender?.name ?? null;

  return (
    <div style={shell(scale)}>
      <div style={{ position: "absolute", left: 34 * scale, top: 34 * scale, width: "44%" }}>
        {sender && (
          <span
            style={{
              display: "inline-block",
              padding: `${6 * scale}px ${16 * scale}px`,
              background: STAMP,
              borderRadius: 999,
              font: `400 ${8.5 * scale}px/1 'Roboto Mono', monospace`,
              letterSpacing: ".24em",
              color: STOCK,
              textTransform: "uppercase",
            }}
          >
            Card from {sender}
          </span>
        )}

        <p
          style={{
            font: `600 ${42 * scale}px/1.1 'Cormorant Garamond', serif`,
            fontStyle: "italic",
            color: VERMILLION,
            marginTop: 16 * scale,
          }}
        >
          {card.channel?.title ?? "—"}
        </p>

        {card.channel?.description && (
          <p
            style={{
              font: `400 ${12.5 * scale}px/1.65 Roboto, sans-serif`,
              color: "rgba(20,19,15,0.65)",
              marginTop: 14 * scale,
            }}
          >
            {card.channel.description}
          </p>
        )}

        <p
          style={{
            font: `500 ${20 * scale}px/1.2 'Cormorant Garamond', serif`,
            fontStyle: "italic",
            color: "rgba(20,19,15,0.85)",
            marginTop: 18 * scale,
          }}
        >
          From {sender ?? "—"}
        </p>
        <p
          style={{
            font: `400 ${8.5 * scale}px/1 'Roboto Mono', monospace`,
            letterSpacing: ".24em",
            color: "rgba(20,19,15,0.55)",
            marginTop: 8 * scale,
            textTransform: "uppercase",
          }}
        >
          For {card.recipient?.name ?? "—"}
        </p>
      </div>

      {/* The rule that splits the bookplate from the stamp — dotted, because a
          solid line would cut the card in two. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: "57%",
          top: 38 * scale,
          bottom: 38 * scale,
          width: 1,
          backgroundImage: "linear-gradient(rgba(20,19,15,0.25) 55%, transparent 55%)",
          backgroundSize: `1px ${8 * scale}px`,
        }}
      />

      {/* The stamp, perforated on both edges — the detail that makes it post. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: 52 * scale,
          top: 44 * scale,
          width: 88 * scale,
          height: 106 * scale,
          background: STAMP,
          transform: "rotate(-5deg)",
          boxShadow: `0 ${3 * scale}px ${10 * scale}px rgba(0,0,0,.16)`,
        }}
      >
        {(["left", "right"] as const).map((side) => (
          <span
            key={side}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              [side]: -4.5 * scale,
              width: 9 * scale,
              backgroundImage: `radial-gradient(circle ${3.2 * scale}px at center, ${STOCK} ${3 * scale}px, transparent ${3.4 * scale}px)`,
              backgroundSize: `${9 * scale}px ${9 * scale}px`,
              backgroundRepeat: "repeat-y",
            }}
          />
        ))}
        {(["top", "bottom"] as const).map((side) => (
          <span
            key={side}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              [side]: -4.5 * scale,
              height: 9 * scale,
              backgroundImage: `radial-gradient(circle ${3.2 * scale}px at center, ${STOCK} ${3 * scale}px, transparent ${3.4 * scale}px)`,
              backgroundSize: `${9 * scale}px ${9 * scale}px`,
              backgroundRepeat: "repeat-x",
            }}
          />
        ))}
        {/* 23a's interior, exactly: the hairline frame, RECALL running up the
            left edge, the postmark's big italic R, POST in the corner. */}
        <span
          style={{
            position: "absolute",
            inset: 6 * scale,
            border: `1px solid rgba(239,232,214,.65)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              position: "absolute",
              left: 5 * scale,
              top: 7 * scale,
              font: `400 ${6 * scale}px/1 'Roboto Mono', monospace`,
              letterSpacing: ".24em",
              color: "rgba(239,232,214,.9)",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            RECALL
          </span>
          <span
            style={{
              font: `600 ${46 * scale}px/1 'Cormorant Garamond', serif`,
              fontStyle: "italic",
              color: STOCK,
              marginTop: -3 * scale,
            }}
          >
            R
          </span>
          <span
            style={{
              position: "absolute",
              right: 6 * scale,
              bottom: 6 * scale,
              font: `400 ${6 * scale}px/1 'Roboto Mono', monospace`,
              letterSpacing: ".22em",
              color: "rgba(239,232,214,.9)",
            }}
          >
            POST
          </span>
        </span>
      </div>

      {/* 23a's provenance block: when this archive was opened. Real when the
          caller knows it, absent when it does not — a printed card carrying
          an invented month is worse than one carrying none. */}
      {card.archive_since && (
        <div
          style={{
            position: "absolute",
            left: "61%",
            right: 34 * scale,
            top: 186 * scale,
            font: `400 ${8.5 * scale}px/2.2 'Roboto Mono', monospace`,
            letterSpacing: ".18em",
            color: "rgba(20,19,15,0.55)",
          }}
        >
          A NEW ARCHIVE,
          <br />
          OPENED FOR YOU
          <br />
          <span style={{ color: "rgba(20,19,15,0.4)" }}>
            {new Date(card.archive_since)
              .toLocaleDateString("en-GB", { month: "long", year: "numeric" })
              .toUpperCase()}
          </span>
        </div>
      )}

      {/*
        23a's instruction, bottom right — the reason the card works at all.
        A postcard she cannot act on is a picture; this is the line that makes
        it a doorway, and it was missing from the back entirely.

        The frame also carries "A NEW ARCHIVE, OPENED FOR YOU · JANUARY 2025"
        above it. That names when this archive opened, which this component is
        not given — and a printed card carrying the wrong month is worse than
        one carrying nothing, so it is left out rather than guessed.
      */}
      <div
        style={{
          position: "absolute",
          right: 34 * scale,
          bottom: 26 * scale,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 9 * scale,
        }}
      >
        <span
          style={{
            font: `400 ${8.5 * scale}px/1 'Roboto Mono', monospace`,
            letterSpacing: ".22em",
            color: "rgba(20,19,15,0.55)",
          }}
        >
          TO OPEN, TYPE
        </span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 10 * scale }}>
          <span
            style={{
              font: `700 ${64 * scale}px/1 Archivo, sans-serif`,
              color: INK,
              letterSpacing: "-.01em",
            }}
          >
            {typeof card.channel?.number === "number"
              ? String(card.channel.number).padStart(2, "0")
              : "--"}
          </span>
          {/* The full stop from the identity (17a): the number ends the
              sentence. Vermillion, not the product's amber — this is ink on
              paper, and the card is the one surface that is printed. */}
          <span
            style={{
              width: 12 * scale,
              height: 12 * scale,
              borderRadius: "50%",
              background: "#C13B22",
              flex: "none",
            }}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * Both faces, as 18d lays them out on the ivory board — at a size that fits.
 *
 * Side by side needs 1356 units of width (two 620 cards, a 36 gap, 40 of mat
 * either side). Stacked needs 700. On a desktop column the caller's own scale
 * is the smaller number and nothing here changes; at 390 the width is, and
 * side-by-side would have to shrink to about a quarter size — two cards too
 * small to read either. So below that point the faces stack, which is 18l's
 * "identical to desktop minus the second column".
 *
 * `flex-wrap` alone did not do this. It wrapped, and then the mat was still
 * 452px wide inside a 350px column, because wrapping changes the layout and
 * not the size of what is being laid out.
 */
export function PostcardPreview({ card, scale = 1 }: { card: NfcCard; scale?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; stacked: boolean }>({
    scale,
    stacked: false,
  });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width > 0) setFit(fitBothFaces(width, scale));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scale]);

  const s = fit.scale;
  return (
    <div ref={box} className="w-full">
      <div
        className={`flex items-center justify-center ${fit.stacked ? "flex-col" : "flex-row"}`}
        style={{ gap: 36 * s, background: "#F4F1EA", borderRadius: 20 * s, padding: 40 * s }}
      >
        <PostcardFront card={card} scale={s} />
        <PostcardBack card={card} scale={s} />
      </div>
    </div>
  );
}

/* ── The fitting rules ────────────────────────────────────────────────────
   Pure, and exported, because they are the part that can be wrong in a way
   nobody sees: a scale that overflows by 12px pushes the page sideways rather
   than clipping, and on a phone that reads as "the layout is a bit loose"
   instead of as a bug. Rendering proves one width; these pin every width.

   The units are the frame's own. One face is 620×440. Two side by side need
   620 + 36 gap + 620, inside 40 of mat either side — 1356. Stacked they need
   620 + 80 — 700.
*/

/** The largest scale at which one face fits `width`, never above `max`. */
export function fitOneFace(width: number, max: number): number {
  return Math.min(max, width / 620);
}

/**
 * Side by side while both faces stay legible, stacked below that.
 *
 * 0.42 is the floor: under it a face is narrower than 260px and the caption
 * and the number stop being readable — two cards too small to read is worse
 * than one you can, which is what 18l means by "minus the second column".
 */
export function fitBothFaces(width: number, max: number): { scale: number; stacked: boolean } {
  const sideBySide = width / 1356;
  if (sideBySide >= 0.42) return { scale: Math.min(max, sideBySide), stacked: false };
  return { scale: Math.min(max, width / 700), stacked: true };
}

/**
 * The card at whatever size it has been given (18l).
 *
 * The two faces are drawn at a fixed 620×440 and scaled — which is right, it
 * keeps every measurement in the frame's own units. But a fixed multiplier is
 * a bet about the viewport, and at 390 the 0.62 the desktop page wants is
 * 384px of card inside a column that is 390 minus its padding. It does not
 * clip visibly; it pushes the page sideways, which is the failure the kiosk
 * rule and the phone frame both exist to prevent.
 *
 * So the scale is measured rather than assumed: the widest that fits, never
 * larger than the caller asked for. On a desktop column the cap is what wins
 * and nothing changes; on a phone the width does.
 */
export function FittedPostcard({
  card,
  face,
  max = 1,
}: {
  card: NfcCard;
  face: "front" | "back";
  max?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(max);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth;
      if (width > 0) setScale(fitOneFace(width, max));
    };
    fit();
    /*
      A resize observer rather than a window listener: the column can change
      width without the window doing anything (a panel opening, the roster
      collapsing), and the preview pane this is verified in fires no window
      resize event at all — a listener would have looked correct and measured
      nothing.
    */
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [max]);

  return (
    <div ref={box} className="w-full" style={{ height: 440 * scale }}>
      {face === "front" ? (
        <PostcardFront card={card} scale={scale} />
      ) : (
        <PostcardBack card={card} scale={scale} />
      )}
    </div>
  );
}
