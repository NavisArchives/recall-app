import { useEffect, useMemo, useRef } from "react";
import { Check, ChevronLeft, ChevronRight, MapPin, Users, X } from "lucide-react";
import { CAPS } from "./kit";
import { BackCircle } from "@/components/BackCircle";
import { Dictate } from "./Dictate";
import type { Author } from "@/types";

/**
 * One photograph, at length (059).
 *
 * This is the pop-up the owner asked for, and since 17 Sep 2026 it is the
 * ONLY place a photograph is described: "you have an explanation that says
 * for every picture we will be asking a more detailed description — are you
 * ready to get started — and if you get started then the pop-up starts."
 *
 * IT USED TO BE TWO VIEWS. There was a grid of describe-rows and a one-by-one
 * page, with a toggle between them, and the owner's verdict on that was
 * "there's too much jumping happening between if I go to all to one by one —
 * it's not my kind of interface." The grid is now a plain contact sheet on
 * step 2 and every description is written here, once, in order. The toggle
 * and the second copy of these fields are gone rather than hidden.
 *
 * THE COUNT IS THE LEFT-HAND HEADLINE — "picture one of nine, in big, on the
 * left side", in the family's accent. It is the thing that tells you this is
 * a run with an end to it rather than a dialog you opened by accident.
 *
 * EVERYTHING HERE IS OPTIONAL, and the panel is built to look finished when
 * it is all empty. A form of five blank required-looking boxes per photograph
 * does not get filled in; it gets abandoned, and then the archive looks
 * half-made. Empty fields say what they would hold, in ordinary words, and
 * nothing is ever marked missing.
 */

export type Precision = "year" | "month" | "day";

export interface PhotoDraft {
  file: File;
  preview: string;
  caption: string;
  /** Year, month or day — whichever precision says. Never padded here. */
  taken_on: string;
  precision: Precision;
  /** A place name, as typed. The server turns it into the archive's own row. */
  place: string;
  /** Person ids from this archive. */
  people: string[];
  error: string | null;
}

const CAPTION_MAX = 200;
const YEAR_SHAPE = /^\d{4}$/;
const MONTH_SHAPE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_SHAPE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Does this draft hold a date its precision can actually store? */
export function dateIsWhole(item: Pick<PhotoDraft, "taken_on" | "precision">): boolean {
  if (!item.taken_on) return true;
  return item.precision === "year"
    ? YEAR_SHAPE.test(item.taken_on)
    : item.precision === "month"
      ? MONTH_SHAPE.test(item.taken_on)
      : DAY_SHAPE.test(item.taken_on);
}

/**
 * The full date the server stores, from the part the family actually typed.
 *
 * A year becomes the first of January and a month becomes the first of the
 * month, because the column holds a date — but `taken_precision` travels with
 * it and says how much of that is real. This is the padding that made the
 * display read "1 August 1978" aloud before 059; the padding is fine, the
 * pretending was not.
 */
export function wholeDate(item: Pick<PhotoDraft, "taken_on" | "precision">): string {
  if (!item.taken_on || !dateIsWhole(item)) return "";
  if (item.precision === "year") return `${item.taken_on}-01-01`;
  if (item.precision === "month") return `${item.taken_on}-01`;
  return item.taken_on;
}

/** The same date in the words a person would say. */
export function spokenDate(item: Pick<PhotoDraft, "taken_on" | "precision">): string | null {
  const whole = wholeDate(item);
  if (!whole) return null;
  const [y, m, d] = whole.split("-").map(Number);
  const when = new Date(y, m - 1, d);
  if (item.precision === "year") return String(y);
  if (item.precision === "month")
    return when.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** A one-line summary of what has been filled in, for the grid's meta strip. */
export function detailSummary(item: PhotoDraft, people: Author[]): string[] {
  const names = item.people
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter((n): n is string => !!n);
  return [spokenDate(item), item.place.trim() || null, names.length ? names.join(", ") : null].filter(
    (v): v is string => !!v
  );
}

const PRECISIONS: { value: Precision; label: string; hint: string }[] = [
  { value: "year", label: "Year", hint: "1978" },
  { value: "month", label: "Month", hint: "August 1978" },
  { value: "day", label: "Day", hint: "3 August 1978" },
];

const FIELD_STYLE = {
  background: "rgba(var(--ink),.05)",
  border: "1px solid rgba(var(--ink),.14)",
  color: "var(--cream, #F2F1EE)",
};

function Label({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className={`flex items-center gap-1.5 ${CAPS}`} style={{ color: "var(--fg-hint)" }}>
      {icon}
      {children}
    </span>
  );
}

/**
 * The date, at whatever precision the family actually has.
 *
 * Three words rather than three date pickers: the picker follows the word,
 * so choosing "Month" cannot leave a day behind in the value. Switching
 * narrows or widens what is already there instead of clearing it — a month
 * typed as August 1978 becomes 1978 when you pick Year, not blank, because
 * losing what someone typed is how a form teaches people not to use it.
 */
function WhenField({
  item,
  onChange,
}: {
  item: PhotoDraft;
  onChange: (patch: Partial<PhotoDraft>) => void;
}) {
  const bad = !dateIsWhole(item);

  function switchTo(precision: Precision) {
    if (precision === item.precision) return;
    const value = item.taken_on;
    let next = "";
    if (value) {
      const [y, m, d] = value.split("-");
      if (precision === "year") next = y ?? "";
      else if (precision === "month") next = y && m ? `${y}-${m}` : "";
      else next = y && m ? `${y}-${m}-${d ?? "01"}` : "";
    }
    onChange({ precision, taken_on: next });
  }

  return (
    <div>
      <Label>WHEN</Label>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {PRECISIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => switchTo(p.value)}
            className="pressable rounded-full px-3 py-1.5 text-[12px]"
            style={
              item.precision === p.value
                ? { background: "var(--chip-on)", color: "var(--on-chip-on)" }
                : { border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      <input
        type={item.precision === "day" ? "date" : item.precision === "month" ? "month" : "number"}
        inputMode={item.precision === "year" ? "numeric" : undefined}
        min={item.precision === "year" ? 1900 : undefined}
        max={
          item.precision === "year"
            ? new Date().getFullYear()
            : new Date().toISOString().slice(0, item.precision === "month" ? 7 : 10)
        }
        placeholder={PRECISIONS.find((p) => p.value === item.precision)?.hint}
        value={item.taken_on}
        onChange={(e) => onChange({ taken_on: e.target.value })}
        className="mt-2 h-11 w-full rounded-[12px] px-3.5 text-[14px] outline-none focus:border-accent"
        style={{
          ...FIELD_STYLE,
          ...(bad ? { borderColor: "var(--destructive-soft)" } : {}),
        }}
      />
      <p className="mt-1.5 text-[11px]" style={{ color: bad ? "var(--destructive-soft)" : "var(--fg-quiet)" }}>
        {bad
          ? "That date is not complete yet."
          : spokenDate(item)
            ? `Read aloud as “${spokenDate(item)}”.`
            : "Only as exact as you actually know."}
      </p>
    </div>
  );
}

/**
 * Where, typed — with the archive's own places offered back.
 *
 * A `datalist` rather than a dropdown: the list is a memory aid, not a menu.
 * The owner's rule for tags is the same rule here — you type the word and it
 * exists — and a dropdown that must be opened before you can invent an entry
 * teaches the opposite.
 */
function WhereField({
  item,
  places,
  onChange,
}: {
  item: PhotoDraft;
  places: string[];
  onChange: (patch: Partial<PhotoDraft>) => void;
}) {
  const listId = useRef(`places-${Math.random().toString(36).slice(2)}`).current;

  return (
    <div>
      <Label icon={<MapPin size={11} strokeWidth={1.9} aria-hidden />}>WHERE</Label>
      <input
        list={listId}
        maxLength={80}
        value={item.place}
        placeholder="Ostend, the house on Rue Verte…"
        onChange={(e) => onChange({ place: e.target.value })}
        className="mt-2 h-11 w-full rounded-[12px] px-3.5 text-[14px] outline-none focus:border-accent placeholder:font-light placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
        style={FIELD_STYLE}
      />
      <datalist id={listId}>
        {places.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </div>
  );
}

/** Who is in it — the family, as faces you switch on. */
function WhoField({
  item,
  people,
  onChange,
}: {
  item: PhotoDraft;
  people: Author[];
  onChange: (patch: Partial<PhotoDraft>) => void;
}) {
  function toggle(id: string) {
    onChange({
      people: item.people.includes(id)
        ? item.people.filter((p) => p !== id)
        : [...item.people, id],
    });
  }

  return (
    <div className="min-h-0">
      <Label icon={<Users size={11} strokeWidth={1.9} aria-hidden />}>WHO IS IN IT</Label>
      {people.length === 0 ? (
        <p className="mt-2 text-[12px]" style={{ color: "var(--fg-quiet)" }}>
          Nobody is in the archive yet.
        </p>
      ) : (
        <div className="scroll-thin mt-2 flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto pr-1">
          {people.map((person) => {
            const on = item.people.includes(person.id);
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => toggle(person.id)}
                aria-pressed={on}
                className="pressable flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[12px]"
                style={
                  on
                    ? { background: "var(--chip-on)", color: "var(--on-chip-on)" }
                    : { border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }
                }
              >
                {person.profile_picture_url ? (
                  <img
                    src={person.profile_picture_url}
                    alt=""
                    className="h-5 w-5 flex-none rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px]"
                    style={{ background: "rgba(var(--ink),.16)", color: "var(--fg-soft)" }}
                  >
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="max-w-[128px] truncate">{person.name}</span>
                {on && <Check size={11} strokeWidth={2.6} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Add a dictated phrase to what is already written, with one space between. */
export function appendPhrase(current: string, phrase: string, max: number): string {
  const joined = current.trim() ? `${current.replace(/\s+$/, "")} ${phrase}` : phrase;
  return joined.slice(0, max);
}

/**
 * The panel itself — the photograph on the left under its count, the five
 * optional fields on the right, and whatever the caller puts in `footer`
 * underneath them.
 */
export function PhotoDetail({
  item,
  index,
  total,
  people,
  places,
  isVideo,
  onChange,
  onStep,
  onClose,
  footer,
}: {
  item: PhotoDraft;
  index: number;
  total: number;
  people: Author[];
  places: string[];
  isVideo: boolean;
  onChange: (patch: Partial<PhotoDraft>) => void;
  onStep: (delta: number) => void;
  onClose?: () => void;
  /** The run's own actions — Previous, Next, Create — kept out of the scroll. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/*
          "Picture one of nine, in big, on the left side" (owner, 17 Sep 2026)
          — and in the family's accent, so the run's position is the first
          thing the eye lands on rather than a caption hidden beside the
          arrows. Tabular figures, or the number jumps sideways between 1
          and 2 on every step.
        */}
        <div className="flex flex-none items-baseline gap-3">
          <span className={CAPS} style={{ color: "var(--fg-hint)" }}>
            {isVideo ? "FILM" : "PICTURE"}
          </span>
          <span
            style={{
              font: "300 clamp(28px,3.2vw,44px)/0.9 'Roboto Mono', ui-monospace, monospace",
              color: "var(--accent-soft)",
              letterSpacing: "-.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            style={{
              font: "300 17px/1 'Roboto Mono', ui-monospace, monospace",
              color: "var(--fg-quiet)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            / {String(total).padStart(2, "0")}
          </span>
        </div>

        {/* The photograph, as large as the room allows. object-contain, because
            a described photograph is one you can actually see — a cover crop
            hides the corner the description is about. */}
        <div
          className="flex min-h-[150px] flex-1 items-center justify-center overflow-hidden rounded-[18px] p-2"
          style={{ background: "rgba(var(--ink),.06)" }}
        >
          {isVideo ? (
            <video src={item.preview} controls className="max-h-full max-w-full rounded-[12px]" />
          ) : (
            <img src={item.preview} alt="" className="max-h-full max-w-full rounded-[12px] object-contain" />
          )}
        </div>
      </div>

      <div className="flex w-full min-w-0 flex-none flex-col lg:w-[360px]">
        <div className="flex flex-none items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => onStep(-1)}
            disabled={total < 2}
            aria-label="Previous photograph"
            className="pressable flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
            style={{ border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }}
          >
            <ChevronLeft size={15} strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            disabled={total < 2}
            aria-label="Next photograph"
            className="pressable flex h-8 w-8 items-center justify-center rounded-full disabled:opacity-40"
            style={{ border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }}
          >
            <ChevronRight size={15} strokeWidth={1.9} aria-hidden />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pressable ml-1 flex h-8 w-8 items-center justify-center rounded-full"
              style={{ border: "1px solid rgba(var(--ink),.18)", color: "var(--fg-soft)" }}
            >
              <X size={15} strokeWidth={1.9} aria-hidden />
            </button>
          )}
        </div>

        {/*
          `overflow-y-auto` is a seatbelt, not the plan: the five fields are
          measured to fit a laptop, and the owner's rule is that this must not
          be a scroll. It engages only on a window short enough that the
          alternative is a field nobody can reach.
        */}
        <div className="scroll-thin mt-3 flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1">
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>DESCRIPTION</Label>
              <span className="font-mono text-[9px]" style={{ color: "rgba(var(--ink),.3)" }}>
                {item.caption.length}/{CAPTION_MAX}
              </span>
            </div>
            {/* The microphone sits INSIDE the box, in its lower-right corner
                (owner, 17 Sep 2026), so it belongs to the thing it writes
                into rather than floating in the label row.

                Its insets are the box's own 14px padding on BOTH axes, so it
                stands on the same margin as the first character of the
                description. `block` on the textarea is what makes that true:
                inline, it left a baseline descender inside this wrapper and
                the circle measured 3px from the bottom against 10px from the
                right. `pr-[52px]` is the circle plus that margin plus a
                hair, so a long sentence stops before it rather than running
                underneath. */}
            <div className="relative mt-2">
              <textarea
                rows={3}
                maxLength={CAPTION_MAX}
                value={item.caption}
                placeholder="What is happening here, in the words she would use…"
                onChange={(e) => onChange({ caption: e.target.value })}
                className="block w-full resize-none rounded-[12px] p-3.5 pr-[52px] text-[14px] leading-[1.55] outline-none focus:border-accent placeholder:font-light placeholder:italic placeholder:text-[color:rgba(var(--ink),0.35)]"
                style={FIELD_STYLE}
              />
              <span className="absolute bottom-3.5 right-3.5">
                <Dictate
                  onText={(phrase) =>
                    onChange({ caption: appendPhrase(item.caption, phrase, CAPTION_MAX) })
                  }
                />
              </span>
            </div>
          </div>

          <WhenField item={item} onChange={onChange} />
          <WhereField item={item} places={places} onChange={onChange} />
          <WhoField item={item} people={people} onChange={onChange} />
        </div>

        {footer && <div className="flex-none pt-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * The pop-up. Escape closes it, the arrow keys walk the set, and the backdrop
 * is a button so a click anywhere outside gets out — the three ways a person
 * expects to leave something that opened over what they were doing.
 *
 * THE WAY BACK STANDS OUTSIDE IT (owner, 17 Sep 2026: "remove the back to
 * photos and add a traditional back button right next outside of the actual
 * pop-up, which is return to pictures"). It used to be a text link in the
 * panel's own footer, competing with the action that moves the run forward.
 * Out here it is the house back circle on the backdrop, in its own row above
 * the dialog rather than floating over a corner of it — a real row, so it can
 * never land on top of the panel on a short window.
 *
 * The circle reads `--ink` and `--fg-muted`, which are dark-on-light in the
 * workspace and would be invisible against this scrim. They are re-declared
 * on the row: a custom property resolves where it is declared, so one wrapper
 * turns the shared control light without a second copy of it existing.
 */
export function PhotoDetailModal(
  props: Parameters<typeof PhotoDetail>[0] & { onClose: () => void; backLabel?: string }
) {
  const { onClose, onStep, backLabel = "Return to the pictures" } = props;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowRight") onStep(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-label={backLabel}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)" }}
      />

      <div className="relative flex max-h-full min-h-0 w-full max-w-[980px] flex-col">
        {/*
          Beside the panel and level with its top-left corner — "like all our
          design elements the return button is always put up… right next to
          the text PICTURE" (owner, 17 Sep 2026).

          Absolutely positioned against the panel rather than placed in a flex
          row beside it, for two reasons: the panel stays centred in the window
          instead of shuffling sideways to make room, and `top` can be measured
          against the panel's own padding, so the circle's TOP edge lands on
          the top of the count row — level with the word PICTURE and with the
          panel's upper-left corner, which is where every other return in this
          product sits. It is the panel's own `sm:p-6`, not a number picked to
          look right once.

          `xl`, not `lg`: at 1024 a 960px panel leaves 32px of margin and the
          circle would hang off the screen. Below that the ✕ in the panel is
          the way out, and the backdrop is the way out at every width.
        */}
        <div className="absolute right-full top-6 mr-4 hidden xl:block">
          <BackCircle onScrim onClick={onClose} label={backLabel} size={44} />
        </div>

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photograph details"
          className="relative flex max-h-full min-h-0 w-full flex-col rounded-[26px] p-5 sm:p-6"
        /*
          `--panel-dialog` is the product's token for exactly this surface, and
          it is the whole reason the pop-up follows the workspace colour: it is
          #171614 in the dark room and the theme's own card in paper, blue and
          green. An earlier draft of this line invented `var(--panel, #171614)`
          — a token that does not exist — so every light theme fell through to
          the literal and the panel came out dark, with the page's dark-on-light
          text on top of it. Invisible. A fallback on a name nothing declares is
          not a fallback, it is the only value.
        */
          style={{
            background: "var(--panel-dialog)",
            border: "1px solid rgba(var(--ink),.12)",
            boxShadow: "0 24px 64px rgba(0,0,0,.28)",
          }}
        >
          <PhotoDetail {...props} />
        </div>
      </div>
    </div>
  );
}

/** The places already in the archive, plus anything typed in this session. */
export function usePlaceSuggestions(known: string[], drafts: PhotoDraft[]): string[] {
  return useMemo(() => {
    const seen = new Map<string, string>();
    for (const name of [...known, ...drafts.map((d) => d.place)]) {
      const trimmed = name.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [known, drafts]);
}
