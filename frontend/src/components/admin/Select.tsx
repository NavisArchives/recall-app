import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * The Recall select, frame 13c: no native dropdown anywhere. A pressed
 * field opens a dark panel; the current value wears the amber check; an
 * optional "Other…" turns the field into free text.
 */
export function Select({
  value,
  options,
  onChange,
  allowOther = false,
  placeholder = "Choose…",
  source = "ready",
  what = "The options",
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
  allowOther?: boolean;
  placeholder?: string;
  /**
   * Where the options came from (M219).
   *
   * Every one of these lists is built with `?? []`, so a failed read hands
   * the field an empty array and it opens a panel with nothing in it. No
   * sentence is false — and that is exactly what makes it worse than a
   * wrong figure: **a figure is read and discounted; a control is acted
   * upon.** An empty picker does not merely misinform, it removes the
   * option, and the person cannot tell a restriction from an absence. They
   * conclude the archive has no channels, or that nobody can be assigned,
   * and go and do something else.
   *
   * `loading` and `failed` are deliberately not collapsed. A control still
   * arriving is not one that could not arrive, and a week of separating
   * those two everywhere else should not end at this component.
   */
  source?: "ready" | "loading" | "failed";
  /** The noun for the message: "The channels", "The contributors". */
  what?: string;
}) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(false);
  // Opens upward when the viewport below is too short — the panel must
  // never be clipped just because the field sits on the last row of a list.
  const [openUp, setOpenUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && root.current) {
      const rect = root.current.getBoundingClientRect();
      const needed = Math.min(options.length + (allowOther ? 1 : 0), 8) * 44 + 16;
      setOpenUp(rect.bottom + needed > window.innerHeight && rect.top > needed);
    }
    setOpen((v) => !v);
  }

  /**
   * The keyboard drives it like a listbox: arrows move, Enter chooses,
   * Escape closes. A native <select> gives this away for free; a custom
   * panel has to earn it, and earning it here covers every call site.
   */
  function onPanelKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(panel.current?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : e.key === "ArrowDown" ? (at + 1) % items.length
      : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (other) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (!value.trim()) setOther(false);
        }}
        placeholder="Say it in a word or two…"
        className="mt-2 h-[50px] w-full rounded-[10px] border bg-transparent px-4 text-[15px] outline-none focus:border-accent"
        style={{ borderColor: "rgba(var(--ink),.22)" }}
      />
    );
  }

  /*
    An empty list we could not read is not a list of nothing. The field
    stops being pressable, because opening an empty panel is the misleading
    act — and it says which of the two states it is in.
  */
  if (source !== "ready") {
    return (
      <div
        className="mt-2 flex h-[50px] w-full items-center rounded-[10px] px-4 text-[14px]"
        style={{
          border: "1px dashed rgba(var(--ink),.22)",
          color: "var(--fg-faint)",
        }}
        aria-disabled="true"
      >
        {source === "loading" ? `${what} are loading…` : `${what} could not be loaded.`}
      </div>
    );
  }

  return (
    <div ref={root} className="relative mt-2">
      <button
        type="button"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="pressable flex h-[50px] w-full items-center justify-between rounded-[10px] px-4 text-[15px]"
        style={{
          border: open ? "2px solid var(--accent)" : "1px solid rgba(var(--ink),.22)",
          color: value ? "var(--fg)" : "var(--fgw-faint)",
        }}
      >
        <span>{value || placeholder}</span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform"
          style={{
            color: open ? "var(--accent)" : "var(--fgw-quiet)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
          aria-hidden
        />
      </button>

      {open && (
        <div
          ref={panel}
          role="listbox"
          onKeyDown={onPanelKey}
          className="absolute inset-x-0 z-20 max-h-[352px] overflow-y-auto rounded-xl p-1.5"
          style={{
            ...(openUp ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
            background: "var(--panel-menu)",
            border: "1px solid rgba(var(--ink),.18)",
            boxShadow: "var(--shadow-menu)",
          }}
        >
          {options.map((option) => {
            const current = option === value;
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className="pressable flex w-full items-center justify-between rounded-lg px-3.5 py-[11px] text-left text-sm"
                style={
                  current
                    ? { background: "rgba(var(--accent-channels),.16)", color: "var(--accent-on-tint)", fontWeight: 500 }
                    : { color: "rgba(var(--ink),.85)" }
                }
              >
                <span>{option}</span>
                {current && <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}
              </button>
            );
          })}

          {allowOther && (
            <>
              <div className="mx-2 my-1.5 h-px" style={{ background: "rgba(var(--ink),.1)" }} />
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOther(true);
                  setOpen(false);
                }}
                className="pressable w-full rounded-lg px-3.5 py-[11px] text-left text-sm italic"
                style={{ color: "var(--fgw-quiet)" }}
              >
                Other…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
