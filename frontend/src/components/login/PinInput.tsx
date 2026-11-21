import { useEffect, useRef, useState } from "react";

/**
 * The one PIN entry, everywhere — frame 2b's vocabulary: six dark cells, a
 * dot per entered digit, a standing orange cursor in the active cell. A
 * single hidden input holds the value so hardware keyboards, on-screen
 * keyboards and paste all work; the cells are only the visual.
 *
 * It used to carry two skins — the kiosk's halo dots (M66) and 2b's cells —
 * and the owner ended that: one selector, one PIN, on every device. The
 * cells won because they are the drawn design; the halo language lives on
 * in the choosers' cards, where it started.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  state = "idle",
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  state?: "idle" | "error" | "success";
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * A wrong code is judged once, not worn for the next attempt (M72).
   *
   * The parents cleared the error on a *timer*, so for the window afterwards
   * every fresh digit painted solid red under a stale "That PIN is not
   * right." — telling the person who had just fumbled that they were still
   * wrong while they typed a code that might be perfectly good.
   *
   * Guarding it here rather than only in the parents is deliberate: both
   * choosers own their own `state`, and a rule that lives in two places is a
   * rule that will hold in one of them. The component remembers the value
   * the error was about, and the moment the value differs the error is
   * somebody else's history.
   */
  const [judged, setJudged] = useState<string | null>(null);
  useEffect(() => {
    if (state === "error") setJudged(value);
    else if (state === "idle") setJudged(null);
    // Only when the verdict changes; a keystroke must not re-arm it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const stale = state === "error" && judged !== null && value !== judged;
  const shown = stale ? "idle" : state;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (value.length === 6) onComplete?.(value);
  }, [value, onComplete]);

  const active = !disabled && shown !== "success" ? value.length : -1;

  return (
    /*
      `w-full` here is load-bearing, and it is why this component owns its
      width instead of borrowing it (M189, second pass).

      The cells below are `flex-1`, i.e. `flex-basis: 0` — they ask their
      parent how much room there is. This wrapper had no class at all, so it
      shrink-wrapped to its content, and its content was asking *it* the
      same question. The circle resolved at the only definite thing in the
      row: the caret. Six 3px hairlines, on the sign-in screen, live.

      The old fixed-width cells never met this because 54px is an answer in
      itself. Fluid children need a definite ancestor, and this is the
      nearest one this component controls — so the chain is closed here
      rather than in whatever page happens to render it.
    */
    <div
      className={`w-full ${shown === "error" ? "animate-[shake_0.4s]" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="sr-only"
        aria-label="Six-digit code"
      />
      {/* Six cells, not four: the mockup's 4 was illustrative, the PIN is
          six digits everywhere (identity-model, isValidPinFormat). The
          cursor is a standing bar — the charter defers motion, so it does
          not blink. */}
      {/*
          The row divides the width it has, rather than demanding a width it
          hasn't (M189 — the owner: "the code is overflowing").

          Six 54px cells and five 12px gaps ask for 384px, inside the card's
          padding and the shell's: about 520px of viewport on a phone that
          has 360-430. Being flex items, the cells did not overflow — they
          *compressed*, into tall thin slots, which is why no width check
          ever caught it and the owner's eyes did.

          `flex-1` with a `max-w` keeps the desktop's 54px wherever it fits
          and shares out what is left where it doesn't; the cell only holds
          a dot or a bar, so a narrower one loses nothing.
      */}
      <div className="flex w-full justify-center gap-2 sm:gap-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className="inline-flex h-14 min-w-0 flex-1 items-center justify-center rounded-[14px] max-w-[54px] sm:h-16"
            style={{
              background: "rgba(var(--ink),.05)",
              border:
                shown === "error"
                  ? "1.5px solid var(--destructive-soft)"
                  : i === active
                    ? "1.5px solid rgba(var(--accent-channels),.65)"
                    : "1px solid rgba(var(--ink),.14)",
            }}
          >
            {i < value.length ? (
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{
                  background:
                    shown === "success" ? "oklch(0.72 0.16 150)" : "var(--cream, #F2F1EE)",
                }}
              />
            ) : i === active ? (
              <span className="h-[22px] w-[2px]" style={{ background: "var(--accent-soft)" }} />
            ) : null}
          </span>
        ))}
      </div>
    </div>
  );
}
