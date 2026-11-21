import { useEffect, useId, useRef, useState } from "react";
import { LANGS, useLang } from "@/lib/publicLang";

/**
 * FR · NL · EN — the one control the public pages share for language.
 *
 * Closed, it is a single disc showing the language you are reading in. Open, a
 * capsule grows downward with all three inside it, the current one ringed in
 * the accent.
 *
 * IT IS GLASS (owner, 18 Sep 2026: "give it a modern, semi transparent
 * design"). Everything it draws is `color-mix` against `currentColor` over a
 * `backdrop-filter`, so the control has no colours of its own: it takes a
 * tint from the text colour it stands in and blurs whatever is behind it. The
 * white capsule this replaces was opaque, which was right when the public
 * pages were all paper and wrong the moment the front page grew a dark hero
 * for it to sit on.
 *
 * WHICH MEANS THE GROUND SETS `color`, and the default is the safe one. On a
 * paper page it inherits the page's ink and is correct with nothing passed. A
 * dark section sets `color: #F2F1EE` on the wrapper — SiteNav and the archive
 * service's nav both do. Forgetting it does not fail silently the way the old
 * `tone` prop did: it draws ink on near-black, which is visible immediately
 * rather than in a screenshot three weeks later.
 *
 * It reads from LANGS rather than a list written here, so adding a fourth
 * language is one edit in publicLang and not a hunt for every place that
 * spelled the set out — which is exactly how French went missing from the
 * landing page's own switch while the page itself was already translated.
 *
 * HOW THE CAPSULE STAYS PUT. The shell is absolutely positioned and inset by
 * its own padding and border, inside a wrapper that is exactly one disc big.
 * So the trigger sits at the same point on the screen whether the thing is
 * open or shut — the capsule grows downward around it rather than the disc
 * moving to make room — and the layout around it never shifts, which matters
 * because it hangs in the corner of a nav that wraps.
 */
const SIZE = 40;
const PAD = 6;
const GAP = 8;

/* Every value is a proportion of the text colour, so one set of numbers works
   on paper and on near-black. */
const tint = (pct: number) => `color-mix(in srgb, currentColor ${pct}%, transparent)`;

const GLASS = "blur(14px) saturate(1.35)";

export function LangToggle() {
  const [lang, setLang] = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  /*
    Escape closes and gives the focus back; a press anywhere else closes
    without stealing it. Both listeners only exist while the panel is open,
    so a page with this control on it carries no handlers at rest.
  */
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const disc = {
    width: SIZE,
    height: SIZE,
    borderRadius: "50%",
    font: "400 12px/1 'Roboto Mono', ui-monospace, monospace",
    letterSpacing: "0.08em",
  } as const;

  const others = LANGS.filter((l) => l !== lang);

  return (
    <div ref={box} className="relative inline-block" style={{ width: SIZE, height: SIZE }}>
      <div
        className="absolute flex flex-col items-center transition-[background-color,border-color,box-shadow]"
        style={{
          /* PAD plus the shell's own 1px border, or the trigger sits a pixel
             down and right of the slot its wrapper reserves. */
          top: -(PAD + 1),
          left: -(PAD + 1),
          padding: PAD,
          gap: GAP,
          zIndex: open ? 20 : undefined,
          borderRadius: 999,
          /*
            The ring is always drawn and merely transparent when shut.
            Toggling the border width instead would move the disc by a pixel
            on every open.
          */
          border: `1px solid ${open ? tint(20) : "transparent"}`,
          background: open ? tint(7) : "transparent",
          backdropFilter: open ? GLASS : undefined,
          WebkitBackdropFilter: open ? GLASS : undefined,
          /* A shadow only where there is a panel to lift off the page. */
          boxShadow: open ? "0 14px 34px rgba(11,11,12,.22)" : "none",
        }}
      >
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`Language — ${lang.toUpperCase()}`}
          onClick={() => setOpen((o) => !o)}
          className="pressable inline-flex flex-none items-center justify-center uppercase transition-colors"
          style={{
            ...disc,
            background: tint(10),
            backdropFilter: GLASS,
            WebkitBackdropFilter: GLASS,
            /* The one place the control is not made of its own text colour:
               the language you are reading in wears the accent, which is what
               tells you the ring means "this one" and not "press here". */
            border: `1.5px solid var(--s-red, #c13b22)`,
            color: "currentColor",
          }}
        >
          {lang}
        </button>

        {open && (
          <ul
            id={panelId}
            role="listbox"
            aria-label="Language"
            className="m-0 flex list-none flex-col p-0"
            style={{ gap: GAP }}
          >
            {others.map((l) => (
              <li key={l} className="contents">
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    setLang(l);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                  className="pressable inline-flex flex-none items-center justify-center uppercase transition-colors"
                  style={{
                    ...disc,
                    background: tint(6),
                    backdropFilter: GLASS,
                    WebkitBackdropFilter: GLASS,
                    border: `1px solid ${tint(26)}`,
                    color: tint(72),
                  }}
                >
                  {l}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
