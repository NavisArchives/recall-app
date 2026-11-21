import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { MonitorSmartphone, Settings } from "lucide-react";
import { MobileShell } from "@/mobile/MobileShell";
import { useIsMobile } from "@/mobile/useIsMobile";
import { TopNav } from "@/components/admin/TopNav";
import { ProfileSwitcher } from "@/components/admin/ProfileSwitcher";
import { HeaderBell } from "@/components/admin/HeaderBell";
import { PaymentNotice } from "@/components/admin/PaymentNotice";
import { useAuth } from "@/context/AuthContext";
import { useWorkspaceTheme } from "@/lib/useWorkspaceTheme";
import { Wordmark } from "@/components/Wordmark";

/**
 * The frame every management screen sits in: a thin bar naming the app, a
 * fixed column of identity on the left, and the tabbed workspace.
 *
 * Unlike Margaret's display — which is a fixed pane the size of the wall
 * it hangs on — this is a web application read up close, so the workspace
 * scrolls. The kiosk's no-scroll rule stays where it belongs.
 */
export function AdminLayout() {
  // Below 1024px the desktop frame — fixed sidebar, tab row, never-scrolling
  // workspace — hands over to the phone shell (wireframes-mobile.md, Part 1).
  // The branch calls no hooks after it, and neither branch's body runs the
  // other's hooks: crossing the breakpoint must not change the hook count.
  const isMobile = useIsMobile();
  return isMobile ? <MobileShell /> : <AdminLayoutDesktop />;
}

function AdminLayoutDesktop() {
  const { isAdmin } = useAuth();
  const asking = useLocation().pathname.startsWith("/admin/ask");
  /*
    The workspace's colour (058), and it is set HERE rather than on <html>:
    that element is shared with Margaret's display, which is dark
    unconditionally. Dark spreads nothing at all, so a workspace nobody has
    repainted renders exactly as it always did.
  */
  const { theme, attrs } = useWorkspaceTheme();
  const lit = theme !== "dark";

  return (
    <div
      {...attrs}
      className="admin-contrast flex h-dvh flex-col overflow-hidden"
      style={{
        background: "var(--ground)",
        // The amber bloom belongs to the dark room. On a light ground it
        // reads as a stain, so the lit themes take the flat ground.
        backgroundImage: lit
          ? undefined
          : "radial-gradient(900px 520px at 88% -12%, rgba(var(--accent-channels),.16), transparent 62%)," +
            "radial-gradient(760px 460px at 4% 112%, rgba(var(--accent-channels),.09), transparent 60%)",
      }}
    >
      {/* Tall enough that the switcher panel, which opens flush with the chip,
          has room above it and is never clipped by the top of the window. */}
      {/*
        20a: the navigation lives in the header as one pill (M106).

        It used to be a bordered tab row under the sidebar, and the header
        carried a clock in the middle. The clock moves to the Overview's own
        archive line ("synced HH:MM"), where it belongs to the thing it
        describes; the middle of the header is now the pill.

        `grid-cols-[1fr_auto_1fr]` rather than three equal columns: the pill
        is sized by its own content and stays truly centred while the
        wordmark and the right-hand cluster take what is left.
      */}
      {/*
        Behind the ask flow the whole shell steps back to 35% (frames 8a/8c)
        — the overlay look without an overlay. It stays clickable: pressing
        a dimmed nav pill leaves the ask, which is exactly what the frames'
        "Esc drops back" means by another door.
      */}
      <header
        className={`grid h-[72px] flex-none grid-cols-[1fr_auto_1fr] items-center gap-6 px-8 ${
          asking ? "opacity-[.35]" : ""
        }`}
        style={{ borderBottom: "1px solid rgba(var(--ink),.12)" }}
      >
        <Link
          to="/admin"
          className="flex w-fit items-baseline gap-[9px] rounded-full px-5 py-[11px]"
          style={{ border: "1px solid rgba(var(--ink),.13)" }}
        >
          <Wordmark size={16} style={{ color: "var(--cream)" }} />
          <span
            className="hidden text-[11px] font-light italic leading-none xl:inline"
            style={{ color: "var(--fg-soft)" }}
          >
            A living archive
          </span>
        </Link>

        <TopNav />

        {/*
          The frame's right cluster, exactly: Settings, the bell, the face.
        */}
        <div className="flex items-center justify-end gap-2">
          {isAdmin && (
            <NavLink
              to="/admin/devices"
              className="hidden items-center gap-2 rounded-full px-4 py-[10px] text-[13px] leading-none lg:flex"
              style={({ isActive }) => ({
                border: "1px solid rgba(var(--ink),.13)",
                color: isActive ? "var(--cream)" : "rgba(var(--ink-cream),.75)",
              })}
            >
              <MonitorSmartphone size={14} strokeWidth={1.7} aria-hidden />
              Devices
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/settings"
              className="flex items-center gap-2 rounded-full px-4 py-[10px] text-[13px] leading-none"
              style={({ isActive }) => ({
                border: "1px solid rgba(var(--ink),.13)",
                color: isActive ? "var(--cream)" : "rgba(var(--ink-cream),.75)",
              })}
            >
              <Settings size={14} strokeWidth={1.7} aria-hidden />
              Settings
            </NavLink>
          )}
          <HeaderBell />
          <ProfileSwitcher compact />
        </div>
      </header>

      {/*
        No sidebar (M106).

        20a gives every page the full width: the identity column's counts move
        into the Overview's own masthead, where they read as context beside
        the greeting rather than as an instrument panel bolted to every
        screen. The pages that wanted the extra room — the shelf grid, the
        contributor cards, the NFC tiles — get it.
      */}
      {/* What is owed, when something is (055). Silent for a paying family. */}
      <PaymentNotice />

      <div className="flex min-h-0 flex-1">
        {/* A region inside the document's one `main` (App.tsx), not a second one (M70). */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-[34px]">
          {/*
            The frame never scrolls — a page that has more to show than fits
            scrolls one of its own regions, never itself.

            The top rhythm lives here rather than on the column above,
            because the tabs sit above it and must stay where they are. Every
            desktop page gets it from the shell now (M75); pages carry no
            `pt-` of their own.
          */}
          <div className="ring-room min-h-0 flex-1 overflow-hidden pt-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
