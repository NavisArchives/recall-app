import { Search } from "lucide-react";
import { BackCircle } from "@/components/BackCircle";

/**
 * The 20a kit.
 *
 * Every core page is this handful of primitives arranged differently, so they
 * live here once. The alternative — each page carrying its own rounded card
 * and its own cream panel — is how a design system becomes six design systems
 * that almost agree.
 *
 * Values are the design file's, not approximations: the surfaces, radii and
 * borders below are lifted from the frames rather than eyeballed.
 */

/**
 * The dark rounded surface every bento cell and page card sits on.
 *
 * It forwards whatever else it is given to the element. That is not
 * politeness: a card tagged `data-placeholder` had its tag swallowed here,
 * so three registered holders on Insights were invisible to
 * `document.querySelectorAll("[data-placeholder]")` — the audit that is
 * supposed to be the last word on what is real. A wrapper that quietly eats
 * attributes can make the register lie.
 */
export function BentoCard({
  className = "",
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`box-border rounded-[26px] ${className}`}
      style={{
        background: "rgba(var(--ink),.045)",
        border: "1px solid rgba(var(--ink),.09)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * A light panel on the dark ground — "a list within a card".
 *
 * The frames use it for the thing being celebrated or worked through: the
 * mission list, a finished mission, the invite code, a nudge. It is the one
 * place the palette inverts, which is what makes it read as important.
 */
export function CreamInset({
  className = "",
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={`panel-inverted box-border rounded-[18px] ${className}`}
      style={{ background: "var(--panel-pale)", color: "var(--on-cream)", ...style }}
    >
      {children}
    </div>
  );
}

/**
 * A mission's state, as one mark (owner 17 Sep 2026).
 *
 * Three shapes and nothing else: a finished mission is a filled accent disc
 * with a white tick through it, one in progress is a ring with the accent
 * sitting in the middle of it, and one nobody has started is an empty ring
 * in whatever ink the surface it stands on is written in.
 *
 * It was drawn three different ways before this — a ✓ typed as a text
 * character in the overview, a hand-rolled <svg> on the missions page, and a
 * lucide <Check> elsewhere — so the same fact had three weights and three
 * sizes. The tick is a stroked path here, which is what makes it read as
 * clean at 18px as it does at 30px.
 *
 * The disc is the accent, so it is amber in the dark room and the theme's
 * own colour in a light one. The tick stays white on all four: white clears
 * 4.5:1 on every accent the product has.
 */
export function MissionMark({
  state,
  size = 18,
  className = "",
}: {
  state: "done" | "doing" | "open";
  size?: number;
  className?: string;
}) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  };

  if (state === "done") {
    return (
      <span className={className} style={{ ...base, background: "var(--accent)" }} aria-hidden>
        <svg
          width={Math.round(size * 0.55)}
          height={Math.round(size * 0.55)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  if (state === "doing") {
    return (
      <span
        className={className}
        style={{ ...base, border: `${Math.max(1.5, size * 0.09)}px solid var(--accent)` }}
        aria-hidden
      >
        <span
          style={{
            width: size * 0.36,
            height: size * 0.36,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      /*
        The empty ring takes the INVERTED panel's ink, not the page's: this
        mark only ever appears inside the mission inset, which is cream on a
        dark page and deep on a light one. Reading --ink here would draw a
        white hairline on cream and disappear.
      */
      style={{ ...base, border: `1.5px solid rgba(var(--on-panel-alt-channels), .25)` }}
      aria-hidden
    />
  );
}

/** The page's name, what it is, and its one primary action. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  /*
    On a phone the actions drop under the title rather than fighting it for
    the row (M101). The 44px title is a desktop size — at 375 it filled the
    width on its own and pushed the actions off the right edge, so the
    primary action of the page was unreachable. Smaller type and a stacked
    row cost nothing on the desktop, where the `md:` values are the frame's.
  */
  return (
    <div className="flex flex-none flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <h1
          className="text-[30px] font-light leading-[1.05] md:text-[44px]"
          style={{ color: "var(--cream)", letterSpacing: "-.01em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <div className="mt-2 text-[13px] md:mt-3" style={{ color: "var(--fg-soft)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 md:flex-none md:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
}

/** The cream call to action — one per page, as the frames have it. */
export function PrimaryPill({
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
      /*
        18l: every target 44px+ on a phone. These pills are 39px, which is a
        comfortable desktop button and a miss on a touchscreen. The floor is
        phone-only — above 640 the frames' own measurements stand, and a pill
        that grew everywhere would break the density 18a and 12 are drawn to.
      */
      className="min-h-[44px] rounded-full px-5 py-[13px] text-[13px] font-medium leading-none disabled:opacity-40 sm:min-h-0"
      style={{ background: "var(--chip-on)", color: "var(--on-chip-on)" }}
    >
      {children}
    </button>
  );
}

/** A quiet bordered pill — the secondary verb beside the primary one. */
export function GhostPill({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] rounded-full px-5 py-[13px] text-[13px] leading-none sm:min-h-0"
      style={{ border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" }}
    >
      {children}
    </button>
  );
}

/** The rounded find-a-thing field. */
export function SearchField({
  placeholder,
  value,
  onChange,
  width = 280,
}: {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  width?: number;
}) {
  return (
    /*
      `maxWidth`, not `width` (M190's sweep, found at 320px).

      An inline `width: 280` cannot shrink, so on any container narrower than
      280 the field simply hung over the edge — 13px off-screen on a 320px
      phone, on the Shelf and NFC pages. This is the *other* half of the
      phone-layout family: the PIN row compressed and stayed inside its box,
      this one refuses to compress and leaves. Neither is visible to a check
      that only asks whether the page scrolls sideways.

      `width` becomes the ceiling and `w-full` the floor: unchanged wherever
      280px fits, and as wide as the space allows where it does not.
    */
    <label
      className="flex h-[46px] w-full items-center gap-2.5 rounded-full px-[18px]"
      style={{
        maxWidth: width,
        background: "rgba(var(--ink),.06)",
        border: "1px solid rgba(var(--ink),.14)",
      }}
    >
      <Search size={14} strokeWidth={1.7} style={{ color: "var(--fg-soft)" }} aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[13px] outline-none placeholder:font-light placeholder:italic"
        style={{ color: "var(--cream)" }}
      />
    </label>
  );
}

/** A labelled stat, in one of the frames' three weights. */
export function StatPill({
  label,
  children,
  tone = "quiet",
  width,
  pushRight = false,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "accent" | "quiet" | "outline";
  width?: number;
  pushRight?: boolean;
}) {
  const tones = {
    accent: { background: "var(--accent)", color: "#fff" },
    quiet: { background: "rgba(var(--ink),.09)", color: "var(--cream)" },
    outline: { border: "1px solid rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.85)" },
  } as const;

  return (
    <div
      style={{
        ...(width ? { width, flex: "none" } : null),
        ...(pushRight ? { marginLeft: "auto" } : null),
      }}
    >
      <div
        className="px-1 pb-2 font-mono text-[9px] tracking-[0.14em]"
        style={{ color: "var(--fg-soft)" }}
      >
        {label}
      </div>
      <div
        className="rounded-full px-5 py-[13px] text-[13px] font-medium leading-none"
        style={tones[tone]}
      >
        {children}
      </div>
    </div>
  );
}

/** The small mono caption the frames use above a group. */
export const CAPS = "font-mono text-[10px] tracking-[0.16em]";

/*
 * The three bands (M114).
 *
 * Every page is NAV (the pill bar, owned by AdminLayout) → SUB-NAV (this
 * page's title and its own controls) → ACTION SECTION (the cards, the grid,
 * the insight). Two things are fixed and identical everywhere, and they live
 * here rather than in six page wrappers: where the title sits, and the line
 * the action section starts on.
 *
 * They had drifted by eight pixels — 93 on Contributors, 98 on the Overview,
 * 101 on the reference pages — because each page set its own top padding and
 * two of them carried `ring-room`, whose -3px margin quietly moved the whole
 * band. Nobody would call that a bug looking at one page; you only see it
 * flipping between them, which is exactly when the eye notices.
 *
 * The sub-nav is a fixed height rather than its content's height. That is the
 * cost of the owner's rule: a page with fewer controls has empty space beneath
 * its title instead of pulling its cards upward. It buys a content line that
 * never moves.
 *
 * 184 is chosen, not inherited. The mission calls Missions and NFC Cards the
 * reference, but measured they do not agree with each other or with the shelf:
 * their content began at 274, 308 and 282. There was no existing line to adopt,
 * so this is the middle of that cluster — the shelf and the Overview barely
 * move, Missions comes down eleven pixels. It also has to clear the tallest
 * sub-nav any page carries, which is the Overview's stat-pill row (78 + 63),
 * because a band shorter than its contents would clip them.
 */
export const SUBNAV_HEIGHT = 184;

/**
 * The roster line (owner, 2026-08-09) — the amendment to the law above.
 *
 * One band everywhere was right for pages that fill it and too tall for
 * pages that cannot. So a page now declares its *type* rather than its
 * pixels:
 *
 *   workspace — it has a genuine control row (Memory Shelf, Missions), so
 *     its content starts on the low line the band buys. Unchanged.
 *   roster    — its collection is small enough that any control would be
 *     fake (a filter over three contributors), so the control row is
 *     omitted and the content starts on a second, HIGHER line.
 *
 * The higher line is one number shared by every roster page, not a value
 * each page picks — the consistency the owner asked for lives in the rule,
 * so two rosters can never drift apart the way the six pages did before
 * M114. And the type is the only thing a page states, which is what makes
 * the graduation clause a flag rather than a rewrite: when a roster's
 * collection genuinely earns controls (~8+ items), it says `workspace` and
 * drops onto the lower line with its real filter row.
 */
export const ROSTER_SUBNAV_HEIGHT = 116;

export type PageType = "workspace" | "roster";

export function PageFrame({
  header,
  children,
  scroll = false,
  type = "workspace",
}: {
  /** The sub-nav's contents: a PageHeader, plus this page's own controls. */
  header: React.ReactNode;
  children: React.ReactNode;
  /** Whether the action section scrolls internally or is handed a fixed box. */
  scroll?: boolean;
  /**
   * Which start line this page's content sits on. Defaults to `workspace`,
   * so a page that has not declared itself keeps exactly today's band and
   * nothing regresses silently.
   */
  type?: PageType;
}) {
  const band = type === "roster" ? ROSTER_SUBNAV_HEIGHT : SUBNAV_HEIGHT;
  /*
    `gap-5 md:gap-0`: on the desktop the fixed band owns the space between
    the sub-nav and the action section, so the frame itself adds none. On a
    phone the band collapses to its content and the two touched — the first
    card sat directly under the subtitle.
  */
  return (
    /*
      The fixed box is the desktop's, not the phone's (owner, 10 Aug).

      This frame was `h-full overflow-hidden` at every width — a box exactly
      as tall as its container that clips whatever does not fit. That is
      right on a desktop, where the admin pages are fixed-height and any
      scrolling happens inside a region. On a phone it is rendered *inside*
      the mobile shell's own scroller, and the result was a page that capped
      itself short of the shell, sliced the last card through the middle,
      and left a band of dead black between that cut and the tab bar — which
      is what the owner saw. Worse than the band: the frame reported
      `scrollHeight === clientHeight`, so the clipped content could not be
      reached by scrolling at all. It was simply gone.

      Below `lg` the frame now takes its natural height and lets the shell
      scroll it. `lg`, not `md`, because that is where the mobile shell hands
      over (`useIsMobile` is max-width 1023) — gating at `md` would leave the
      same bug alive between 768 and 1023.

      `flex-1` is gated with the rest on purpose: `flex-1` sets
      `flex-basis: 0`, and in an auto-height column that collapses the
      section to nothing instead of letting it grow.
    */
    <div className="flex min-h-0 flex-col gap-5 pb-[30px] pt-2 md:gap-0 lg:h-full lg:overflow-hidden">
      <div
        className="flex flex-none flex-col justify-start gap-4 md:h-[var(--subnav)] md:overflow-hidden"
        style={{ ["--subnav" as string]: `${band}px` }}
      >
        {header}
      </div>

      {/*
        The action section. A flex column either way, so a page whose content
        scrolls itself (the shelf's grid, the mission board) keeps working
        exactly as it did — `flex-1` inside still means "the rest of the box".
        `scroll` is for the pages that hand over a tall stack instead.
      */}
      <div
        className={
          // Same rule: the internal scroller and the clip belong to the
          // desktop's fixed box. On a phone the shell is the scroller, and a
          // region that scrolls inside a scrolling page is a thumb-trap.
          scroll
            ? "scroll-thin ring-room flex min-h-0 flex-col pr-1 lg:flex-1 lg:overflow-y-auto"
            : "flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden"
        }
      >
        {children}
      </div>
    </div>
  );
}


/**
 * The circled back arrow — the workspace's one way of saying "up a level"
 * (owner-directed). The create flow drew it first; every detail page uses
 * this now instead of a mono text link, so the eye learns one shape.
 */
export function BackArrow({ to, label }: { to: string; label: string }) {
  /* The shape lives in components/BackCircle now — this kept its own copy of
     the same path, which is how the public pages ended up with a different
     arrow nobody noticed. */
  return <BackCircle to={to} label={label} size={44} />;
}
