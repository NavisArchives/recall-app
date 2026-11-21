import { Fragment, useEffect, useRef, useState } from "react";
import { useDisplay } from "@/lib/DisplayContext";
import { useRemoteKeys } from "@/hooks/useGlobalKeyboardControls";
import { px, fromTop } from "@/lib/designSpace";

/**
 * One step of a guide: a picture of the thing, and a sentence about it.
 *
 * Deliberately not `MediaFile` or `StepItem` — the two callers store their
 * steps in different tables, and the presentation should not care which.
 */
export interface GuideStep {
  id: string;
  text: string | null;
  imageUrl: string | null;
}

const CREAM = "#F2F1EE";
const MUTED = "rgba(242,241,238,.55)";
const FAINT = "rgba(242,241,238,.4)";
const ACCENT = "#C87941";
const ACCENT_TEXT = "#E29A68";

/**
 * A guide — frame 24h. One step fills the screen.
 *
 * The order of the left column is the redesign: she knows what the guide IS
 * first — "My breakfast" leads at 46px — then "Step 1" in amber, then the
 * one-sentence instruction, and one photograph of this step only.
 *
 * **No thumbnail strip, ever.** A guide must not show what is coming: a grid
 * of nine steps asks her to choose, and choosing is the hard part. Progress
 * is a numbered step line ABOVE the photograph — the workspace flow's own
 * stepper language, so the family sees the same shape twice — plus STEP 1
 * OF 6 in the header.
 *
 * **Arrows move one step and do not wrap.** The end of a guide is the end of
 * the task; wrapping from "enjoy your coffee" back to "fill the kettle"
 * would tell her the task never finishes. This is the one screen where the
 * arrows deliberately hit an edge (the album and the family row both wrap).
 */
export function Guide({
  label,
  steps,
  onStepChange,
}: {
  /** The guide's own name — the title the column leads with. */
  label: string;
  steps: GuideStep[];
  /** Fires on every step the viewer arrives at, the first one included. */
  onStepChange?: (index: number) => void;
}) {
  const { setBackdrop, setStatus } = useDisplay();
  const [index, setIndex] = useState(0);
  const wheelCooldown = useRef(false);

  const current = steps[index];

  useEffect(() => {
    if (current?.imageUrl) setBackdrop(current.imageUrl);
    return () => setBackdrop(null);
  }, [current, setBackdrop]);

  /* 24h's header: the hint, and STEP 1 OF 6 in amber. `counterNoun` exists
     for exactly this line. */
  useEffect(() => {
    if (!steps.length) return;
    setStatus({
      hint: "Use the arrows for the next step",
      current: index + 1,
      total: steps.length,
      counterNoun: "STEP",
    });
    return () => setStatus(null);
  }, [steps.length, index, setStatus]);

  useEffect(() => {
    if (steps.length) onStepChange?.(index);
    // The caller is told which step, not asked to re-run this on its own
    // identity — an inline handler would fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps.length]);

  /* Clamped, never wrapped — see the header comment. */
  function go(target: number) {
    if (!steps.length) return;
    setIndex(Math.min(Math.max(target, 0), steps.length - 1));
  }

  useRemoteKeys({
    onPrev: steps.length > 1 ? () => go(index - 1) : undefined,
    onNext: steps.length > 1 ? () => go(index + 1) : undefined,
  });

  function handleWheel(event: React.WheelEvent) {
    if (wheelCooldown.current || steps.length < 2) return;
    const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(delta) < 15) return;
    go(index + (delta > 0 ? 1 : -1));
    wheelCooldown.current = true;
    setTimeout(() => {
      wheelCooldown.current = false;
    }, 350);
  }

  if (!steps.length || !current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="t-title">No steps yet.</p>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0" onWheel={handleWheel}>
      {/* ── The words, left (56px, in the frame's own order) ──────────── */}
      <div className="absolute" style={{ left: px(56), top: fromTop(262), width: "31%" }}>
        <p
          className="font-mono uppercase"
          style={{ fontSize: px(12), letterSpacing: ".26em", color: MUTED }}
        >
          A guide
        </p>

        <h1
          style={{
            font: `700 ${px(46)}/1.15 Roboto, sans-serif`,
            color: CREAM,
            marginTop: px(16),
          }}
        >
          {label}
        </h1>

        <p style={{ marginTop: px(18) }}>
          <span style={{ font: `300 ${px(54)}/1 Roboto, sans-serif`, color: ACCENT_TEXT }}>
            Step {index + 1}
          </span>
          <span
            style={{
              font: `300 ${px(22)}/1 Roboto, sans-serif`,
              color: MUTED,
              marginLeft: px(12),
            }}
          >
            of {steps.length}
          </span>
        </p>

        <p
          style={{
            font: `300 ${px(25)}/1.45 Roboto, sans-serif`,
            color: CREAM,
            marginTop: px(20),
            maxWidth: "22ch",
            textWrap: "pretty",
          }}
        >
          {current.text}
        </p>

        {/* The promise that makes one-at-a-time safe to trust. */}
        <p
          className="font-mono uppercase"
          style={{
            fontSize: px(12),
            lineHeight: 1.9,
            letterSpacing: ".2em",
            color: FAINT,
            marginTop: px(34),
          }}
        >
          One step at a time —
          <br />
          the next one waits for you
        </p>
      </div>

      {/* ── The step line, above the photograph ───────────────────────── */}
      <div
        className="absolute flex items-center"
        style={{ left: "39%", right: px(56), top: fromTop(224) }}
      >
        {steps.map((step, i) => {
          const done = i < index;
          const now = i === index;
          return (
            <Fragment key={step.id}>
              <button
                type="button"
                aria-label={`Step ${i + 1}`}
                aria-current={now ? "step" : undefined}
                onClick={() => go(i)}
                className="box-border flex flex-none items-center justify-center rounded-full"
                style={{
                  width: px(30),
                  height: px(30),
                  font: `500 ${px(13)}/1 Roboto, sans-serif`,
                  /* The current step is the amber ring; done steps keep a
                     quiet tick of colour; ahead stays hollow — the same
                     grammar as the send flow's stepper. */
                  color: now ? ACCENT_TEXT : done ? ACCENT_TEXT : FAINT,
                  border: now
                    ? `2px solid ${ACCENT}`
                    : done
                      ? `1px solid ${ACCENT}`
                      : "1px solid rgba(242,241,238,.28)",
                  background: "transparent",
                }}
              >
                {i + 1}
              </button>
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="h-px flex-1"
                  style={{
                    margin: `0 ${px(10)}`,
                    background: i < index ? "rgba(200,121,65,.5)" : "rgba(242,241,238,.18)",
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {/* ── The photograph of this step only ──────────────────────────── */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: "39%",
          right: px(56),
          top: fromTop(276),
          bottom: px(56),
          borderRadius: px(18),
          boxShadow: "0 24px 70px rgba(0,0,0,.5)",
          background: "rgba(242,241,238,.05)",
        }}
      >
        {current.imageUrl ? (
          <img
            key={current.id}
            src={current.imageUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center"
            style={{ font: `300 ${px(18)}/1 Roboto, sans-serif`, color: FAINT }}
            data-placeholder="guide-step-photo"
          >
            No picture for this step
          </span>
        )}
      </div>
    </div>
  );
}
