import { createContext, useContext, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Home, LayoutGrid, Plus, Target, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useWorkspaceTheme } from "@/lib/useWorkspaceTheme";
import { MobileProfileChip } from "./MobileProfileChip";
import { PaymentNotice } from "@/components/admin/PaymentNotice";
import { TABS } from "@/components/admin/TabNav";
import { Sheet, SheetCancel } from "./Sheet";
import { AddFlow, type AddTarget } from "./AddFlow";
import type { Channel } from "@/types";
import { Wordmark } from "@/components/Wordmark";

/*
 * The phone shell (wireframes-mobile.md, Part 1; frames 16a and 16g).
 *
 * A slim header, a screen that scrolls like any phone page, and a five-item
 * bottom nav whose centre is the reason the app is on this phone at all: Add,
 * raised and amber. The desktop's clock is gone — the phone's status bar has
 * one — and the sidebar's content lives in Overview now.
 *
 * The desktop's "frame never scrolls" law does not apply here. That law
 * belongs to Margaret's display alone.
 */

interface MobileUI {
  /** Open the Add flow — optionally already scoped to a channel. */
  openAdd: (target?: AddTarget | Channel) => void;
}

const MobileUIContext = createContext<MobileUI>({ openAdd: () => {} });
export const useMobileUI = () => useContext(MobileUIContext);

/** The four main destinations; everything else lives behind More. */
const MAIN = ["/admin", "/admin/shelf", "/admin/missions"];

/** Destinations that exist as pages but were never desktop tabs. */
const EXTRA: { to: string; label: string; adminOnly?: boolean }[] = [
  { to: "/admin/activity", label: "Activity" },
  { to: "/admin/channels/deleted", label: "Recently deleted", adminOnly: true },
];

export interface MoreDestination {
  to: string;
  label: string;
}

/**
 * Everything behind More, in one place.
 *
 * The sheet and the Overview's tile grid both read this, so the two can
 * never disagree about what the phone can reach. It obeys the desktop's
 * rule exactly: a destination someone's role cannot open is absent, not
 * dimmed — a co-author's list is simply shorter.
 */
export function moreDestinations(isAdmin: boolean): MoreDestination[] {
  return [...TABS.filter((t) => !MAIN.includes(t.to)), ...EXTRA]
    .filter((t) => isAdmin || !t.adminOnly)
    .map(({ to, label }) => ({ to, label }));
}

/**
 * How much room every mobile page leaves for the nav.
 *
 * The bar itself, plus the raised button's overhang, plus whatever the phone
 * reserves at the bottom. Defined once and applied on the shell's scroller —
 * per-page copies drift, and the overview proved it by being forgotten.
 */
export const NAV_CLEARANCE = "calc(96px + env(safe-area-inset-bottom))";

export function MobileShell() {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [add, setAdd] = useState<{ open: boolean; target?: AddTarget }>({ open: false });

  const openAdd = (target?: AddTarget | Channel) =>
    setAdd({
      open: true,
      target:
        target && "id" in target
          ? { kind: "channel", channel: target as Channel }
          : (target as AddTarget | undefined),
    });

  const more = moreDestinations(isAdmin);

  const navItem =
    "flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[10px]";

  const { theme, attrs } = useWorkspaceTheme();

  return (
    <MobileUIContext.Provider value={{ openAdd }}>
      {/*
        `h-dvh`, not `h-screen` (M188 — the owner, on his phone, on the live
        site).

        `h-screen` is `100vh`, and on a mobile browser `vh` is the *large*
        viewport: the height this page would have if the address bar were
        hidden. It is not hidden. So this column was told it had more room
        than it does, and its last flex child — the tab bar — was drawn
        underneath the browser's toolbar. The "+" lost its top, and on the
        chooser (same bug, `overflow-hidden` there) the log-out button was
        not merely off-screen but unreachable.

        The safe-area insets in this file are correct and stay. They answer
        the *device's* chrome — notch, home indicator. They say nothing
        about the *browser's* toolbar, which no inset describes. `dvh`
        answers that half; both halves are needed.

        A no-op on Margaret's screen: a kiosk browser has no retracting
        toolbar, so there `dvh` and `vh` are the same number.
      */}
      <div
        {...attrs}
        /* `mobile-shell` scopes the phone's corner radii and date-field
           rules in index.css to this tree alone. */
        className="mobile-shell admin-contrast flex h-dvh flex-col"
        /* 058: the hard-coded black is the dark room's ground; a lit theme
           takes its own. Dark is byte-identical to before. */
        style={{ background: theme === "dark" ? "#0a0a0a" : "var(--ground)" }}
      >
        {/* Centred vertically, quiet, and no taller than it needs to be —
            a product's masthead, not a prototype's banner. */}
        <header
          className="flex flex-none items-center justify-between px-[22px] pb-2.5"
          style={{
            paddingTop: "calc(10px + env(safe-area-inset-top))",
            minHeight: 52,
          }}
        >
          <div className="flex items-baseline gap-2">
            <Wordmark size={16} />
            <span className="hidden text-[11px] font-light italic text-fg-faint min-[360px]:inline">
              A living archive
            </span>
          </div>
          <MobileProfileChip />
        </header>

        {/*
          Pages scroll vertically like any phone web page — and every one of
          them clears the nav, because the clearance lives here (M71).

          It used to be per-page padding. `MobileShelf` got it, `MobileOverview`
          was forgotten, and its last lines scrolled under the bar. One value
          on the scroller means the next page written cannot be forgotten the
          same way; pages must not add their own on top.
        */}
        {/*
          The container (M75). The shell frames every page; a page frames
          nothing.

          Gutters, top rhythm and the nav clearance all live here, so a page
          rendered through this `Outlet` is correctly framed with no layout
          classes of its own. Tonight proved why three times over — the
          Missions page, the editor and the carousel were each "fixed" by
          adding this same padding to one more file, and several files were
          simply forgotten. A frame that every page has to remember is a
          frame that some page will not.

          A page that wants the edge takes it deliberately, with the
          `-mx-[22px]` breakout idiom. Bleeding is a choice; framing is not.
        */}
        {/* What is owed, when something is (055). Silent for a paying family. */}
        <PaymentNotice />

        <div
          className="scroll-thin min-h-0 flex-1 overflow-y-auto px-[22px] pt-2.5"
          style={{ paddingBottom: NAV_CLEARANCE }}
        >
          <Outlet />
        </div>

        {/*
          The nav is a surface, not a set of floating icons (M71).

          The raised + pokes ~16px above the bar's top edge, and the bar's
          opaque background started *at* that edge — so the crescent around
          the top of the circle was bare page, and cards scrolled through it.
          The band the button rises into is now part of the nav: same colour,
          drawn above the border, so content passes underneath and is fully
          occluded at every scroll position.
        */}
        <nav
          className="relative flex flex-none items-stretch px-2"
          style={{
            borderTop: "1px solid rgba(var(--ink),.12)",
            background: "var(--bg-deep)",
            paddingBottom: "env(safe-area-inset-bottom)",
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-full h-5"
            style={{ background: "var(--bg-deep)" }}
          />
          <NavLink to="/admin" end className={navItem}>
            {({ isActive }) => (
              <Tab icon={<Home className="h-5 w-5" />} label="Overview" active={isActive} />
            )}
          </NavLink>
          <NavLink to="/admin/shelf" className={navItem}>
            {({ isActive }) => (
              <Tab icon={<LayoutGrid className="h-5 w-5" />} label="Shelf" active={isActive} />
            )}
          </NavLink>

          {/* The raised amber centre — the reason the app is on this phone. */}
          <button
            type="button"
            onClick={() => openAdd()}
            aria-label="Add memories"
            /*
              Above the backdrop, not under it. The backdrop is absolutely
              positioned and so paints over in-flow siblings — which squared
              off the top of the circle the moment it was added.
            */
            className="relative z-10 flex flex-1 items-start justify-center"
          >
            <span
              className="-mt-4 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-accent text-accent-foreground"
              style={{ boxShadow: "var(--shadow-tile)" }}
            >
              <Plus className="h-6 w-6" />
            </span>
          </button>

          <NavLink to="/admin/missions" className={navItem}>
            {({ isActive }) => (
              <Tab icon={<Target className="h-5 w-5" />} label="Missions" active={isActive} />
            )}
          </NavLink>
          <button type="button" onClick={() => setMoreOpen(true)} className={navItem}>
            <Tab icon={<MoreHorizontal className="h-5 w-5" />} label="More" active={false} />
          </button>
        </nav>

        {/*
          THE SHEETS LIVE INSIDE THE THEMED ROOT (owner, 21 Sep 2026: "it's
          not themed"). They used to be siblings of the div above, outside
          the element that carries `data-ws-theme` — so a family that had
          chosen paper got a paper workspace with a near-black More sheet
          and a near-black Add sheet rising out of it, amber and all. A
          fixed-position element does not care where it sits in the tree
          for layout; it cares very much for the cascade.
        */}
        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)}>
        <div className="flex flex-col">
          {more.map((item, i) => (
            <button
              key={item.to}
              type="button"
              onClick={() => {
                setMoreOpen(false);
                navigate(item.to);
              }}
              className="flex h-[54px] items-center text-left text-[15px]"
              style={{
                borderBottom:
                  i < more.length - 1 ? "1px solid rgba(var(--ink),.08)" : undefined,
              }}
            >
              {item.label}
            </button>
          ))}
          <div className="mt-1.5">
            <SheetCancel onClose={() => setMoreOpen(false)} />
          </div>
        </div>
      </Sheet>

        {add.open && (
          <AddFlow target={add.target} onClose={() => setAdd({ open: false })} />
        )}
      </div>
    </MobileUIContext.Provider>
  );
}

function Tab({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <span
      className="flex flex-col items-center gap-1 pb-2 pt-2.5"
      style={{ color: active ? "var(--accent-soft)" : "var(--fgw-hint)" }}
    >
      {icon}
      <span className="text-[10px] leading-none">{label}</span>
    </span>
  );
}
