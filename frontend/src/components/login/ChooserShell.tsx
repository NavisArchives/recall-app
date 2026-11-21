import "@/pages/onboarding/site.css";
import { useState, type ReactNode } from "react";
import { ArrowLeft, LogOut } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { useWorkspaceTheme } from "@/lib/useWorkspaceTheme";

/**
 * The one frame every profile selector is drawn in (owner-directed, frame 2a).
 *
 * Both roads to the chooser — the living-room device and a member's own
 * phone — render through this, so they are the same screen: the wordmark and
 * a circled back-arrow at the head, the family's screen status in the right
 * corner (never a clock), the question, the body, and one foot carrying the
 * sign-out. What differs between the two is only what each is *allowed* to
 * show (her card lives on her device alone), never the design.
 */

/**
 * The door's ground, brought along because the chooser renders outside the
 * layout. Light since 17 Sep 2026 (owner) and hard-coded rather than themed —
 * the `.door` class beside it restates the whole token set for a light
 * surface, so ink and ground agree whatever the device says. The amber bloom
 * belonged to the dark room and does not survive the move.
 */
/*
  The chooser's ground follows the workspace's colour (owner, 17 Sep 2026).

  It was a fixed `#F7F3EB` with the `.door` palette pinned on top, so someone
  who had chosen Blue signed in, met an amber-and-paper chooser, and only
  reached their own colour one screen later. The theme is the person's, not
  the page's, and it should hold from the door to the dashboard.

  Dark is included: with no theme attribute this resolves to the dark room's
  own ground, which is what somebody on Dark asked for. The PUBLIC sign-in
  page is deliberately not part of this — nobody is identified there yet, so
  there is no "their colour" to honour, and it keeps the light door.
*/
export const GROUND = { background: "var(--ground)" } as const;

/** The way back — an arrow in a soft grey disc (owner-directed), never a word. */
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[rgba(var(--ink),0.06)]"
      style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.14)" }}
    >
      <ArrowLeft size={18} strokeWidth={1.9} style={{ color: "rgba(var(--ink-cream),.8)" }} />
    </button>
  );
}

/**
 * The family's screen, stated once in the corner — its status, not the hour.
 *
 * `current_channel_number` carries three answers, not two: a number (playing
 * that channel), `null` (known to be quiet), or `undefined` (this caller
 * cannot see what is playing — the name alone, no invented status). The
 * device knows; a remote phone knows only the name (M146), and must not
 * claim "quiet" for a screen it cannot read.
 */
export function ScreenPill({
  screen,
}: {
  screen?: { display_name: string | null; current_channel_number?: number | null } | null;
}) {
  if (!screen) return null;
  const name = screen.display_name?.trim() || "The family screen";
  const known = screen.current_channel_number !== undefined;
  const playing = known && screen.current_channel_number !== null;
  return (
    <div
      className="flex items-center gap-2.5 rounded-full px-4 py-2.5"
      style={{ border: "1px solid rgba(var(--ink),.13)" }}
    >
      <span
        className="h-[7px] w-[7px] rounded-full"
        style={{ background: playing ? "#57B26B" : "rgba(var(--ink-cream),.35)" }}
      />
      <span className="text-[12px]" style={{ color: "rgba(var(--ink-cream),.75)" }}>
        {name}
        {!known
          ? ""
          : playing
            ? ` · playing CH ${String(screen.current_channel_number).padStart(2, "0")}`
            : " · quiet right now"}
      </span>
    </div>
  );
}

/**
 * The one header, used by the chooser and the PIN screen alike — so the
 * moment you pick a profile the top of the page does not rearrange itself.
 * Wordmark and the circled back-arrow on the left, the screen's status on
 * the right. The back-arrow is the same disc everywhere; it never becomes a
 * line of text on one screen and a circle on another.
 */
export function ChooserHeader({
  onBack,
  screen,
}: {
  onBack?: () => void;
  screen?: { display_name: string | null; current_channel_number?: number | null } | null;
}) {
  return (
    <div className="flex flex-none items-start justify-between">
      <div className="flex items-center gap-3.5">
        <div
          className="flex items-baseline gap-2.5 rounded-full px-5 py-[11px]"
          style={{ border: "1px solid rgba(var(--ink),.13)" }}
        >
          <Wordmark size={16} style={{ color: "var(--cream)" }} />
          <span className="text-[11px] font-light italic" style={{ color: "var(--fg-soft)" }}>
            A living archive
          </span>
        </div>
        {onBack && <BackButton onClick={onBack} />}
      </div>
      <ScreenPill screen={screen} />
    </div>
  );
}

export function ChooserShell({
  title,
  subtitle,
  onBack,
  screen,
  onSignOut,
  footNote,
  corner,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  onBack?: () => void;
  screen?: { display_name: string | null; current_channel_number?: number | null } | null;
  onSignOut?: () => void;
  /** The quiet line under the foot — "Recall is invitation-only", etc. */
  footNote?: ReactNode;
  /**
   * A small standing control in the bottom-left corner — setup, not choosing.
   *
   * It has its own column rather than being absolutely positioned over the
   * foot, so the note and the log-out stay centred on the page and nothing
   * can slide underneath anything else as the note gets longer.
   */
  corner?: ReactNode;
  children: ReactNode;
}) {
  const { attrs } = useWorkspaceTheme();
  return (
    /*
      The kiosk never scrolls; a phone must (owner: "the profile selector on
      mobile is not responsive"). The app's `main` is a fixed viewport, so a
      taller-than-the-screen chooser cannot grow the page — below `md` this
      column scrolls ITSELF inside that fixed box, and from `md` up the TV
      rule returns.
    */
    <div {...attrs} className="door-contrast flex h-dvh flex-col overflow-y-auto px-5 pb-6 pt-6 sm:px-8 md:overflow-hidden md:px-10" style={GROUND}>
      <ChooserHeader onBack={onBack} screen={screen} />

      {/* the question and the profiles */}
      <div className="flex flex-1 flex-col items-center justify-start py-6 md:min-h-0 md:justify-center md:py-0">
        <p
          className="text-[44px] font-light"
          style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em", lineHeight: 1.05 }}
        >
          {title}
        </p>
        <p className="mt-3.5 text-center text-[13px]" style={{ color: "var(--fg-soft)" }}>
          {subtitle}
        </p>

        <div className="mt-11 flex w-full items-stretch justify-center">{children}</div>
      </div>

      {/*
        one foot, one row (frame 7a): the note, a hairline divider, and the
        log-out as an icon pill — a bubble like every other standing control
        here (wordmark, back circle, screen pill), set beside the note rather
        than stacked beneath it. The label is the plain "Log out of this
        family"; the family password returns the machine, which the sign-in
        page is where a person learns.
      */}
      <div className="grid flex-none grid-cols-[1fr_auto_1fr] items-center gap-4 pb-1">
        <div className="flex justify-start">{corner}</div>

        <div className="flex items-center justify-center gap-5">
        {/* --fg-hint, not --fg-dim: this page can be dark again now that it
            follows the person's colour, and the dim step measures 4.1:1 on
            the dark ground. */}
        {footNote && (
          <p className="text-[12px]" style={{ color: "var(--fg-hint)" }}>
            {footNote}
          </p>
        )}
        {footNote && onSignOut && (
          <span className="h-4 w-px" style={{ background: "rgba(var(--ink),.14)" }} aria-hidden />
        )}
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] transition-colors hover:bg-[rgba(var(--ink),0.06)]"
            style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
          >
            <LogOut size={15} strokeWidth={1.8} aria-hidden />
            Log out of this family
          </button>
        )}
        </div>

        {/* The balancing column, so the middle is the page's middle. */}
        <div aria-hidden />
      </div>
    </div>
  );
}

/* ─────────────────────────────── the cards ─────────────────────────────── */

const TILE_CHIP = "rounded-full px-2.5 py-[5px] font-mono text-[9px] leading-none tracking-[0.08em]";

/**
 * A face, framed the way the whole product frames faces. Initials are the
 * honest fallback for a profile with no picture — and for one whose picture
 * fails to load, since a broken-image glyph on a sign-in screen is worse
 * than the letter it replaces.
 */
function CardFace({
  name,
  photoUrl,
  size,
  adminRing,
}: {
  name: string;
  photoUrl: string | null;
  size: number;
  adminRing?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ring = adminRing ? { boxShadow: "0 0 0 4px var(--accent-tint)" } : {};
  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
        style={{ width: size, height: size, ...ring }}
        className="flex-none rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size / 3, ...ring }}
      className="flex flex-none items-center justify-center rounded-full bg-[rgba(var(--ink),0.1)] font-medium"
    >
      {name.charAt(0)}
    </span>
  );
}

export interface ChooserPerson {
  id: string;
  name: string;
  relationship: string | null;
  role: "admin" | "co_author";
  photoUrl: string | null;
  locked: boolean;
  /** Invited but not set up yet (M67) — a real state with a real next step. */
  pending: boolean;
  isYou: boolean;
}

/**
 * The subject's hand-back card — her screen, returned to her (M29). Larger
 * and warm-bordered, sitting left of the divider. Only ever rendered where
 * her face is allowed: the trusted device, never a remote phone.
 */
export function SubjectCard({
  name,
  photoUrl,
  held,
  onHold,
  onPick,
}: {
  name: string;
  photoUrl: string | null;
  held: boolean;
  onHold: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={onHold}
      onFocus={onHold}
      aria-label={`${name} — her main screen, opens with one touch`}
      /* Wider than the profile tiles by design, and wider again at the
         owner's ask: this card is the whole left column, and its sentence
         ("Back to her channels, just as she left them.") was wrapping to
         three lines inside 236px. */
      className="flex w-full max-w-[340px] flex-none flex-col items-center justify-center gap-4 rounded-[26px] px-7 py-9 sm:w-[300px]"
      style={{
        background: "rgba(var(--accent-channels),.06)",
        border: held ? "1.5px solid rgba(var(--accent-channels),.7)" : "1.5px solid rgba(var(--accent-channels),.38)",
      }}
    >
      <CardFace name={name} photoUrl={photoUrl} size={104} />
      <span className="flex flex-col items-center gap-[5px] text-center">
        <span
          className="text-[20px] font-semibold leading-[1.15]"
          style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em" }}
        >
          {name}
        </span>
        <span className="text-[11px]" style={{ color: "var(--fg-soft)" }}>
          Her main screen
        </span>
      </span>
      <span className={TILE_CHIP} style={{ background: "rgba(var(--accent-channels),.16)", color: "var(--accent-soft)" }}>
        MAIN SCREEN
      </span>
      <span className="max-w-[220px] text-center text-[11px] leading-[1.5]" style={{ color: "var(--fg-hint)" }}>
        Back to her channels, just as she left them.
      </span>
    </button>
  );
}

/** A family member's card — the grid unit, identical on every route. */
export function ProfileTile({
  person,
  held,
  onHold,
  onPick,
}: {
  person: ChooserPerson;
  held: boolean;
  onHold: () => void;
  onPick: () => void;
}) {
  const chip = person.locked
    ? "LOCKED"
    : person.pending
      ? "INVITED"
      : person.role === "admin"
        ? "ADMIN"
        : "CONTRIBUTOR";
  return (
    <button
      type="button"
      disabled={person.locked}
      onClick={onPick}
      onMouseEnter={onHold}
      onFocus={onHold}
      aria-label={
        person.pending
          ? `${person.name} — invited, not joined yet`
          : `${person.name}${person.relationship ? ` — ${person.relationship}` : ""}`
      }
      className="flex w-full min-w-0 flex-col items-center gap-3 rounded-[26px] px-4 py-6 disabled:opacity-40 sm:w-[212px] sm:flex-none sm:px-5"
      style={{
        background: "rgba(var(--ink),.045)",
        border: held ? "1.5px solid rgba(var(--accent-channels),.65)" : "1px solid rgba(var(--ink),.09)",
      }}
    >
      <CardFace name={person.name} photoUrl={person.photoUrl} size={84} adminRing={person.role === "admin"} />
      <span className="flex flex-col items-center gap-[5px] text-center">
        <span
          className="text-[17px] font-semibold leading-[1.2]"
          style={{ color: "var(--cream, #F2F1EE)", letterSpacing: "-.01em" }}
        >
          {person.name}
        </span>
        <span className="text-[11px]" style={{ color: "var(--fg-soft)" }}>
          {person.relationship ?? (person.role === "admin" ? "Administrator" : "Co-author")}
        </span>
      </span>
      <span
        className={TILE_CHIP}
        style={
          person.locked || person.pending
            ? { border: "1px solid rgba(var(--ink),.16)", color: "var(--fg-faint)" }
            : person.role === "admin"
              ? { background: "rgba(var(--accent-channels),.16)", color: "var(--accent-soft)" }
              : { background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }
        }
      >
        {chip}
      </span>
      {person.isYou && (
        <span className="font-mono text-[9px] tracking-[0.2em]" style={{ color: "var(--accent-on-tint)" }}>
          YOU
        </span>
      )}
    </button>
  );
}

/** The dashed door for the invited-but-not-set-up — the same tile everywhere. */
export function FirstTimeTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 flex-col items-center justify-center gap-3 rounded-[26px] px-4 py-6 sm:w-[212px] sm:flex-none sm:px-5"
      style={{ border: "1px dashed rgba(var(--ink),.22)" }}
    >
      <span
        className="flex h-[84px] w-[84px] items-center justify-center rounded-full text-[30px] font-light"
        style={{ border: "1px dashed rgba(var(--ink),.3)", color: "var(--fg-soft)" }}
      >
        +
      </span>
      <span className="text-center">
        <span className="block text-[15px] font-medium" style={{ color: "rgba(var(--ink-cream),.85)" }}>
          First time here?
        </span>
        <span className="mt-[5px] block text-[11px] leading-[1.4]" style={{ color: "var(--fg-hint)" }}>
          Find your name +<br />enter your code.
        </span>
      </span>
    </button>
  );
}

/* ──────────────────────── density: 7f and its stack ────────────────────── */

/**
 * How many people the chooser grid can hold before it must collapse (7f).
 *
 * The grid is a fixed six cells — three across, two down — and the sixth is
 * permanently "First time here?". That leaves five for people. Once a sixth
 * person exists, the fifth cell is surrendered to the See more card, so four
 * faces are drawn and the rest are stacked behind it.
 *
 * Six is not a taste: measured on the live chooser at 1440x900, a 212x245
 * tile gets exactly two rows between the title block and the foot. The
 * design's "the 3x2 grid from 7a never grows" and the viewport agree, which
 * is the happiest kind of constraint — the layout refuses to grow because
 * there is nowhere to grow into, on a screen that by charter never scrolls.
 *
 * A NOTE ON A CONFLICT IN THE SOURCE, because the next person will meet it:
 * 7f's margin annotation says "under 4 contributors the See more card simply
 * isn't there", but 7a — the frame it is a variant of — draws FIVE people and
 * no See more card. The drawn pixels win here: the artwork is the thing the
 * owner approved, and prose about a layout is easier to get wrong than the
 * layout itself. So the card appears at the sixth person, not the fifth. If
 * the annotation was the intent, this is a one-constant change.
 */
export const GRID_CELLS = 6;
export const PEOPLE_WHEN_COLLAPSED = GRID_CELLS - 2; // one cell each: See more, First time
export const MAX_PEOPLE_SHOWN = GRID_CELLS - 1; // no See more card needed

/** Split a family into the faces the grid draws and the ones it stacks. */
export function splitForDensity<T>(people: T[]): { shown: T[]; hidden: T[] } {
  if (people.length <= MAX_PEOPLE_SHOWN) return { shown: people, hidden: [] };
  return {
    shown: people.slice(0, PEOPLE_WHEN_COLLAPSED),
    hidden: people.slice(PEOPLE_WHEN_COLLAPSED),
  };
}

/**
 * The fifth cell when the family outgrows the grid (7f).
 *
 * Dressed as a peer of the person cards on purpose — same surface, same
 * border, same radius, same name and role slots — so the grid still reads as
 * one row of faces rather than a grid with a control wedged into it. The one
 * amber element in the whole grid is the count bubble, which is the only
 * thing here that is not a person.
 *
 * The stack shows three initials and then counts the rest, so it degrades the
 * same way the grid does: it never grows, it says how much it is hiding.
 */
export function SeeMoreCard({
  hidden,
  total,
  onOpen,
}: {
  /** The people not drawn in the grid — their initials fill the stack. */
  hidden: { id: string; name: string }[];
  /** Everyone in the family circle, excluding the subject (chip: "ALL n"). */
  total: number;
  onOpen: () => void;
}) {
  const faces = hidden.slice(0, 3);
  const rest = hidden.length - faces.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`See ${hidden.length} more ${hidden.length === 1 ? "contributor" : "contributors"}`}
      className="flex w-full min-w-0 flex-col items-center gap-3 rounded-[26px] px-4 py-6 sm:w-[212px] sm:flex-none sm:px-5"
      style={{ background: "rgba(var(--ink),.045)", border: "1px solid rgba(var(--ink),.09)" }}
    >
      {/* The stack: 40px circles stepped 22px, each ringed in the ground
          colour so the overlap reads as depth rather than as a smear. */}
      <span className="relative block h-[84px] w-[106px]">
        <span className="absolute left-0 top-[22px] block h-[40px] w-[106px]">
          {faces.map((person, i) => (
            <span
              key={person.id}
              className="absolute top-0 flex h-[40px] w-[40px] items-center justify-center rounded-full text-[14px]"
              style={{
                left: i * 22,
                background: "rgba(var(--ink),.12)",
                border: "2px solid #121113",
                color: "var(--cream)",
              }}
            >
              {person.name.charAt(0).toUpperCase()}
            </span>
          ))}
          {rest > 0 && (
            <span
              className="absolute top-0 flex h-[40px] w-[40px] items-center justify-center rounded-full font-mono text-[11px] font-medium"
              style={{
                left: faces.length * 22,
                background: "rgba(var(--accent-channels),.22)",
                border: "2px solid #121113",
                color: "#E29A68",
              }}
            >
              +{rest}
            </span>
          )}
        </span>
      </span>

      <span className="text-[15px] font-semibold" style={{ color: "var(--cream)", letterSpacing: "-.01em" }}>
        See more
      </span>
      <span className="-mt-1.5 text-[10.5px]" style={{ color: "var(--fg-soft)" }}>
        {hidden.length} more {hidden.length === 1 ? "contributor" : "contributors"}
      </span>
      <span className={TILE_CHIP} style={{ background: "rgba(var(--ink),.08)", color: "rgba(var(--ink-cream),.85)" }}>
        ALL {total}
      </span>
    </button>
  );
}
