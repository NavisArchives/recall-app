/**
 * The workspace's destinations — the list, not a rendering of it.
 *
 * The desktop draws these as the 20a header pill (`TopNav`) and the phone's
 * More sheet reads the same array, so the two surfaces cannot drift apart.
 */
/*
 * Every helper sees the whole workspace.
 *
 * The owner's rule: a co-author can see everything and simply cannot change
 * or delete it — the lock says so where it applies. Hiding half the tabs
 * told a caretaker the product was smaller than it is, and left them unable
 * to look up the things they were invited to help with.
 */
// Exported so the mobile More sheet consumes the same definition — the
// wireframe's rule: the two surfaces must be unable to drift apart.
export const TABS: { to: string; label: string; adminOnly?: boolean; end?: boolean }[] = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/shelf", label: "Memory Shelf" },
  { to: "/admin/contributors", label: "Contributors" },
  { to: "/admin/cards", label: "Cards" },
  { to: "/admin/missions", label: "Missions" },
  { to: "/admin/insights", label: "Insights" },
  // Everyone's own details; for a co-author this is the last tab, which
  // reads as "the one about me".
  { to: "/admin/my-info", label: "My Info" },
  // Whose archive this is — the masthead chip's destination, listed here so
  // a phone can reach it without the desktop masthead.
  { to: "/admin/users", label: "Users" },
  // Hardware is an admin's decision (052) — ordering commits the family to
  // something arriving at the door.
  { to: "/admin/devices", label: "Devices", adminOnly: true },
  // The archive's own settings stay the admin's — a helper edits themselves
  // in My Info, not the family's profile here.
  { to: "/admin/settings", label: "Settings", adminOnly: true },
];

