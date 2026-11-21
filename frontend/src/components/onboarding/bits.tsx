import { useEffect, useRef } from "react";
import { Wordmark } from "@/components/Wordmark";
import { BackCircle } from "@/components/BackCircle";
import { LangToggle } from "@/components/login/LangToggle";
import "@/pages/onboarding/site.css";

/**
 * The shared furniture of the onboarding screens (frames 11a–11e): a thin
 * bar naming the app, a step label, and the fields. Deliberately outside
 * the admin shell — nobody signing up has an archive to show yet.
 */

export const LABEL = "block font-mono text-[10px] tracking-[0.16em] text-fg-faint";
/* The same label on the paper ground, where --fg-faint is a dark-room value. */
export const LABEL_PAPER = "block font-mono text-[10px] tracking-[0.16em]";
export const INPUT =
  "mt-2 h-[52px] w-full rounded-[10px] border bg-transparent px-[18px] text-base outline-none focus:border-accent";
export const INPUT_BORDER = { borderColor: "rgba(var(--ink),.22)" };

/*
  Two grounds, one frame.

  "ink" is the near-black the claim and PIN screens are drawn on — those are
  the end of an invitation, reached from a link, and they belong to the
  product's dark half.

  "paper" is the public one: the same warm ground and vermillion the landing
  page and the front door wear. A stranger asking to be let in has not met
  the dark half yet, and a page that opens near-black before anyone has been
  invited reads as somebody else's software.

  Both are written down rather than themed. Nothing here has identified the
  person reading it, so there is no colour of theirs to borrow.
*/
export type ChromeTone = "ink" | "paper";

const GROUND: Record<ChromeTone, { page: string; rule: string }> = {
  ink: { page: "#0a0a0a", rule: "rgba(var(--ink),.12)" },
  paper: { page: "#f7f3eb", rule: "rgba(20,19,15,.12)" },
};

export function OnboardingChrome({
  step,
  tone = "ink",
  back,
  children,
}: {
  step?: string;
  tone?: ChromeTone;
  /*
    The accessible name of the way back. Present only on the public pages —
    a claim or a PIN screen is the end of a link and has nowhere to go back
    to, so it does not get one.
  */
  back?: string;
  children: React.ReactNode;
}) {
  const ground = GROUND[tone];
  const paper = tone === "paper";

  return (
    <div
      className={`flex h-dvh flex-col overflow-hidden${paper ? " site" : ""}`}
      style={{ background: ground.page }}
    >
      <header
        className="flex h-[84px] flex-none items-center justify-between px-6 md:px-14"
        style={{ borderBottom: `1px solid ${ground.rule}` }}
      >
        <div className="flex items-baseline gap-3.5">
          <Wordmark size={17} />
          <span
            className="hidden text-[13px] font-light italic sm:inline"
            style={{ color: paper ? "rgba(20,19,15,.5)" : undefined }}
          >
            A living archive
          </span>
        </div>
        {/* The public ground offers the language; the invitation-link screens
            do not, because the invitation already arrived in one. */}
        {paper ? (
          <LangToggle />
        ) : (
          step && (
            <span className="font-mono text-[11px] tracking-[0.14em]">{step}</span>
          )
        )}
      </header>

      {back && (
        <div className="flex-none px-6 pt-3 md:px-14">
          <BackCircle label={back} size={40} />
        </div>
      )}

      {/*
        Centred when it fits, top-aligned when it does not.

        `items-center justify-center` on the scroll container itself loses the
        top of anything taller than the box: a column flex spills its overflow
        EQUALLY at both ends, and a scroll container cannot scroll above its
        own start — so the title of this page sat above the reachable area and
        simply was not there. The inner wrapper is at least the height of the
        container, which centres a short page and lets a tall one begin at the
        top where it can be read.
      */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-6 py-3">
        <div className="flex min-h-full w-full items-center justify-center">{children}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      /*
        The dark label, like every other primary button (M193).

        This one was `text-white` on the accent — measured at **3.0:1**,
        which clears the 3:1 floor for large text and UI by nothing at all
        and fails the 4.5:1 that body-sized text is held to. The
        `--accent-foreground` used on every other primary button in the
        product measures **6.2:1** on the same background. It was the only
        light-on-accent label left, so this is a correction to one outlier
        rather than a change of style — and it lands on the door where
        somebody asks a stranger for access to their family's archive.
      */
      className="flex h-[54px] w-full items-center justify-center rounded-xl text-[15px] font-medium text-accent-foreground transition-[filter] hover:brightness-110 disabled:opacity-40"
      style={{ background: "var(--accent)" }}
    >
      {children}
    </button>
  );
}

/**
 * The second action on a screen — "Resend the code", "Skip for now", "Back".
 *
 * A button is a shape, always (owner, 17 Sep 2026: "can't be having items
 * looking unfinished — buttons are always styled"). These were bare
 * underlined words, which on a finished page read as something that had not
 * been drawn yet rather than as something you may press.
 *
 * It takes its colours from tokens rather than literals, so the same control
 * is right on the ink ground and on the paper one.
 */
export function SecondaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="pressable inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13.5px] leading-none transition-colors disabled:opacity-40"
      style={{ border: "1px solid var(--line)", color: "var(--fg-muted)" }}
    >
      {children}
    </button>
  );
}

/**
 * A row of entry boxes — the login code and the PIN both live in one hidden
 * input, the boxes being nothing but its reflection. The box about to be
 * filled wears the amber border, exactly as the frames draw it.
 */
export function CodeBoxes({
  length,
  value,
  onValue,
  masked = false,
  digitsOnly = false,
  boxWidth = 62,
  boxHeight = 76,
  autoFocus = true,
}: {
  length: number;
  value: string;
  onValue: (next: string) => void;
  masked?: boolean;
  digitsOnly?: boolean;
  boxWidth?: number;
  boxHeight?: number;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  function handleChange(raw: string) {
    const cleaned = (digitsOnly ? raw.replace(/\D/g, "") : raw.replace(/[^a-zA-Z0-9]/g, ""))
      .toUpperCase()
      .slice(0, length);
    onValue(cleaned);
  }

  return (
    <div
      className="relative flex w-full cursor-text justify-center gap-2 sm:gap-3"
      onClick={() => input.current?.focus()}
    >
      <input
        ref={input}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        inputMode={digitsOnly ? "numeric" : "text"}
        autoComplete="one-time-code"
        aria-label={masked ? "PIN" : "Login code"}
        className="absolute inset-0 opacity-0"
      />
      {Array.from({ length }).map((_, i) => {
        const filled = i < value.length;
        const current = i === value.length;
        return (
          <div
            key={i}
            aria-hidden
            className="flex min-w-0 flex-1 items-center justify-center rounded-xl font-mono"
            style={{
              /*
                The boxes shrink to fit rather than run off the screen (M93).
                They were fixed pixels, so six of them plus gaps came to more
                than a 375px phone has and the last one was cut — on the one
                page an invitee cannot avoid.

                `flex-1` with a `maxWidth` gives the desktop its exact former
                size whenever there is room, and lets the row divide what
                there is when there is not. The aspect ratio carries the
                height down with the width, so a squeezed box stays a box
                rather than becoming a slot.
              */
              maxWidth: boxWidth,
              aspectRatio: `${boxWidth} / ${boxHeight}`,
              fontSize: `clamp(15px, 4.4vw, ${boxWidth / 2}px)`,
              border: current
                ? "2px solid var(--accent)"
                : `1px solid rgba(var(--ink),${filled ? ".35" : ".2"})`,
            }}
          >
            {filled ? (
              masked ? (
                <span
                  className="rounded-full"
                  style={{ width: 10, height: 10, background: "#fff" }}
                />
              ) : (
                value[i]
              )
            ) : (
              ""
            )}
          </div>
        );
      })}
    </div>
  );
}
