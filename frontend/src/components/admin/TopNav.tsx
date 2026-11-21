import { NavLink } from "react-router-dom";
import { useMissions } from "@/hooks/useAdminData";

/**
 * The 20a top navigation: one segmented pill, centred in the header.
 *
 * The tabs used to sit in a bordered row beneath the header, underlined in
 * amber. 20a moves them into the header itself as a single pill — the active
 * destination in cream, the rest quiet on the dark ground — which is what
 * keeps orange scarce enough to still mean something where it is used.
 *
 * The destinations come from `TABS` in TabNav, which the phone's More sheet
 * also reads, so the two surfaces cannot drift apart. This renders the six
 * that belong in the pill; the personal and archive settings live in the
 * header's right-hand cluster, next to the person they belong to.
 */
const IN_PILL = new Set([
  "/admin",
  "/admin/shelf",
  "/admin/contributors",
  "/admin/cards",
  "/admin/missions",
  "/admin/insights",
]);

export function TopNav() {
  const { data: missions } = useMissions();

  // The badge counts what is actually waiting, not everything ever made.
  const open = (missions ?? []).filter((m) => m.status !== "completed").length;

  const items = [
    { to: "/admin", label: "Overview", end: true },
    { to: "/admin/shelf", label: "Memory Shelf" },
    { to: "/admin/contributors", label: "Contributors" },
    { to: "/admin/cards", label: "Cards" },
    { to: "/admin/missions", label: "Missions", badge: open },
    { to: "/admin/insights", label: "Insights" },
  ].filter((i) => IN_PILL.has(i.to));

  return (
    <nav
      className="flex items-center gap-0.5 rounded-full p-1"
      style={{ background: "rgba(var(--ink),.05)", border: "1px solid rgba(var(--ink),.08)" }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className="flex items-center gap-[7px] whitespace-nowrap rounded-full text-[13px] leading-none"
          style={({ isActive }) =>
            isActive
              ? // Cream, not amber: the active tab is where you are, which is a
                // fact rather than an alarm. Amber stays for things that ask.
                {
                  background: "var(--chip-on)",
                  color: "var(--on-chip-on)",
                  fontWeight: 500,
                  padding: "9px 17px",
                }
              : { color: "rgba(var(--ink-cream),.75)", padding: "9px 15px" }
          }
        >
          {({ isActive }) => (
            <>
              <span>{item.label}</span>
              {item.badge ? (
                <span
                  className="rounded-full font-mono text-[10px] font-medium leading-none"
                  style={
                    isActive
                      ? { background: "rgba(0,0,0,.12)", color: "var(--on-chip-on)", padding: "3px 7px" }
                      : {
                          background: "rgba(var(--accent-channels),.18)",
                          color: "var(--accent-soft)",
                          padding: "3px 7px",
                        }
                  }
                >
                  {item.badge}
                </span>
              ) : null}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
