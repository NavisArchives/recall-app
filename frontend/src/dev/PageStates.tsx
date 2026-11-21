import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/context/AuthContext";
import {
  getLedger,
  installStub,
  resetLedger,
  watchLedger,
  type StubCall,
  type StubMode,
  type StubRole,
} from "./stateStub";

/**
 * M199 — the nineteen profile-gated admin pages, in the states production
 * cannot show, at any width, with no credential in play.
 *
 * The sibling of `StatesGallery`. That one holds *components* in states a
 * live sweep cannot reach; this one holds whole **pages**, mounted for real
 * — the actual route component, its actual queries, its actual
 * `useAuth()` branches — with only the server's answers replaced.
 *
 * Feedback's note when it proposed this: it would have caught M197's two
 * backstop holes by eye. That is the argument for it. `MobileOverview`
 * claiming "Nothing waiting" on a failed load was invisible to a test that
 * did not walk `src/mobile/`, and would have been unmissable on a screen.
 *
 * ── One page at a time, and why ──────────────────────────────────────────
 *
 * A wall of four modes side by side would be the nicer gallery, and it is
 * not possible honestly: the stub stands on `window.fetch`, which is one
 * global with no way to tell which frame a request came from. Four frames
 * would share one mode. So this shows one page in one mode, and the mode is
 * genuinely that mode, rather than four frames of which three are pretending.
 *
 * ── The router is the app's own ──────────────────────────────────────────
 *
 * The first attempt wrapped each page in a `MemoryRouter` to supply its
 * params, and react-router v7 refuses outright: "You cannot render a
 * <Router> inside another <Router>." So the state lives in the real URL
 * instead — `/dev/pages/contributors/dev-id?mode=error&role=admin` — which
 * turned out better than what it replaced. Every state is a link, so a
 * finding can be handed to somebody as the address that shows it rather
 * than as a list of things to click.
 */

const ROLES: StubRole[] = ["admin", "co_author", "user"];
const MODES: StubMode[] = ["ready", "empty", "error", "notfound", "paused"];

interface PageEntry {
  /** The route as written in `App.tsx`, params and all. */
  path: string;
  /** The component's exported name — what the registry test matches on. */
  name: string;
  load: () => Promise<{ default: ComponentType }>;
  /**
   * Which roles the real guard admits, read from `App.tsx` rather than
   * guessed. This is the static half of "which of the nineteen need admin":
   * `<Admin adminOnly>` allows `["admin"]`, plain `<Admin>` allows
   * `["admin", "co_author"]`, and no page here admits `user`.
   */
  allow: StubRole[];
}

const named = <K extends string>(key: K, mod: Record<K, ComponentType>) => ({ default: mod[key] });

const BOTH: StubRole[] = ["admin", "co_author"];
const ADMIN_ONLY: StubRole[] = ["admin"];

/*
  All nineteen. `pageRegistry.test.ts` fails if `App.tsx` grows a twentieth
  and this list does not — the harness must not be able to go quietly out of
  date, which is the failure mode that made M197 necessary.
*/
export const PAGES: PageEntry[] = [
  { path: "/admin", name: "OverviewPage", allow: BOTH,
    load: () => import("@/pages/admin/OverviewPage").then((m) => named("OverviewPage", m)) },
  { path: "/admin/shelf", name: "ShelfPage", allow: BOTH,
    load: () => import("@/pages/admin/ShelfPage").then((m) => named("ShelfPage", m)) },
  { path: "/admin/missions", name: "MissionsPage", allow: BOTH,
    load: () => import("@/pages/admin/MissionsPage").then((m) => named("MissionsPage", m)) },
  { path: "/admin/ask", name: "AskPage", allow: BOTH,
    load: () => import("@/pages/admin/AskPage").then((m) => named("AskPage", m)) },
  { path: "/admin/activity", name: "ActivityPage", allow: BOTH,
    load: () => import("@/pages/admin/ActivityPage").then((m) => named("ActivityPage", m)) },
  { path: "/admin/profile", name: "SubjectProfilePage", allow: BOTH,
    load: () => import("@/pages/admin/SubjectProfilePage").then((m) => named("SubjectProfilePage", m)) },
  { path: "/admin/edit-channel/:id", name: "EditChannel", allow: BOTH,
    load: () => import("@/pages/admin/EditChannel").then((m) => named("EditChannel", m)) },
  { path: "/admin/channels/:id/preview", name: "ChannelPreviewPage", allow: BOTH,
    load: () => import("@/pages/admin/ChannelPreviewPage").then((m) => named("ChannelPreviewPage", m)) },
  { path: "/admin/create-channel", name: "AdminUpload", allow: BOTH,
    load: () => import("@/pages/AdminUpload").then((m) => named("AdminUpload", m)) },
  { path: "/admin/cards", name: "CardsPage", allow: BOTH,
    load: () => import("@/pages/admin/CardsPage").then((m) => named("CardsPage", m)) },
  /*
    Added by this seat, not the one that wrote the page (design §18).

    `cards/new` landed in `2191317` without a registry entry, which is
    exactly what `pageRegistry.test.ts` exists to catch — and it did, on
    committed main. One line here is cheaper than a red suite on a shared
    tree, and the page is inspectable from the moment it exists rather than
    whenever somebody remembers.
  */
  { path: "/admin/cards/new", name: "NewPostcardPage", allow: BOTH,
    load: () => import("@/pages/admin/NewPostcardPage").then((m) => named("NewPostcardPage", m)) },
  { path: "/admin/cards/schedule", name: "SchedulePage", allow: BOTH,
    load: () => import("@/pages/admin/SchedulePage").then((m) => named("SchedulePage", m)) },
  { path: "/admin/cards/:id", name: "CardDetailPage", allow: BOTH,
    load: () => import("@/pages/admin/CardDetailPage").then((m) => named("CardDetailPage", m)) },
  { path: "/admin/devices", name: "DevicesPage", allow: ADMIN_ONLY,
    load: () => import("@/pages/admin/DevicesPage").then((m) => named("DevicesPage", m)) },
  { path: "/admin/users", name: "UsersPage", allow: BOTH,
    load: () => import("@/pages/admin/UsersPage").then((m) => named("UsersPage", m)) },
  { path: "/admin/insights", name: "InsightsPage", allow: BOTH,
    load: () => import("@/pages/admin/InsightsPage").then((m) => named("InsightsPage", m)) },
  { path: "/admin/my-info", name: "MyInfoPage", allow: BOTH,
    load: () => import("@/pages/admin/MyInfoPage").then((m) => named("MyInfoPage", m)) },
  { path: "/admin/contributors", name: "ContributorsPage", allow: BOTH,
    load: () => import("@/pages/admin/ContributorsPage").then((m) => named("ContributorsPage", m)) },
  { path: "/admin/contributors/:id", name: "ContributorProfilePage", allow: BOTH,
    load: () => import("@/pages/admin/ContributorProfilePage").then((m) => named("ContributorProfilePage", m)) },

  { path: "/admin/settings", name: "SettingsPage", allow: ADMIN_ONLY,
    load: () => import("@/pages/admin/SettingsPage").then((m) => named("SettingsPage", m)) },
  { path: "/admin/channels/deleted", name: "DeletedChannelsPage", allow: ADMIN_ONLY,
    load: () => import("@/pages/admin/DeletedChannelsPage").then((m) => named("DeletedChannelsPage", m)) },
  { path: "/admin/contributors/invite", name: "InvitePage", allow: ADMIN_ONLY,
    load: () => import("@/pages/admin/InvitePage").then((m) => named("InvitePage", m)) },
  { path: "/admin/contributors/:id/edit", name: "ContributorEditPage", allow: ADMIN_ONLY,
    load: () => import("@/pages/admin/ContributorEditPage").then((m) => named("ContributorEditPage", m)) },
  { path: "/admin/create-author", name: "CreateAuthor", allow: ADMIN_ONLY,
    load: () => import("@/pages/CreateAuthor").then((m) => named("CreateAuthor", m)) },

  /*
    Not an /admin route, and here on purpose (M221).

    The owner dashboard is one of three screens Andy named as having to be
    perfect before launch, and it was the only one nobody could look at in a
    failed state: its routes sit behind the platform-owner guard, so
    `?fail=` cannot reach them from a family session. It reports whether the
    platform is alright — the last screen that should be unwitnessable.

    `pageRegistry.test.ts` knows about this one deliberately, by name, so
    the registry can still fail on a twentieth ADMIN route appearing.
  */
  { path: "/owner", name: "OwnerDashboard", allow: ADMIN_ONLY,
    load: () => import("@/pages/owner/OwnerDashboard").then((m) => named("OwnerDashboard", m)) },
];

// Lazy component identities are created once at module load. Creating them
// inside Frame would reset page state on each render and violates React's
// static component rule.
const PAGE_COMPONENTS = new Map(
  PAGES.map((page) => [page.name, lazy(page.load)] as const)
);

const BASE = "/dev/pages";

/** The route as the nested `<Routes>` sees it — `/admin` already consumed. */
function relative(path: string): string {
  // `/owner` is not under /admin (M221); it keeps its own segment.
  if (!path.startsWith("/admin")) return path.replace(/^\//, "");
  return path.slice("/admin".length).replace(/^\//, "") || "/";
}

/** A concrete URL for a route that carries params. */
function concrete(path: string): string {
  return relative(path).replace(/:[^/]+/g, "dev-id");
}

/**
 * Does this address belong to this page?
 *
 * Matching the placeholder string exactly was not enough: paste a **real**
 * id — which is how you look at a real record in `ready` mode — and nothing
 * matched, so the gallery fell back to the first page and drew an empty
 * frame. That cost me the one positive control I needed for M203: proof
 * that the form still appears when the person *does* load.
 */
function matches(path: string, here: string): boolean {
  const pattern = relative(path)
    .split("/")
    .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${pattern}$`).test(here);
}

/**
 * A page that throws is a result, not the end of the session.
 *
 * Without this, the first page that could not survive its own empty state
 * took the whole harness down with it — and because React unmounts the root,
 * every page *after* it in a sweep reported nothing at all. Fourteen pages
 * read as blank when one of them had thrown. That is the M197 failure again,
 * in the tool built to catch M197: silence that looks like a pass.
 *
 * So the throw is caught, named, and shown. A page that cannot render its
 * own empty or failed state is one of the more serious things this gallery
 * can find, and it should be the loudest thing on the screen rather than the
 * reason the screen is empty.
 */
class Caught extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { label: string }) {
    if (prev.label !== this.props.label && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <p className="text-[15px]" style={{ color: "var(--destructive-soft)" }}>
          This page threw while rendering this state.
        </p>
        <p className="mt-2 text-[13px] text-fg-muted">
          A family would see a blank screen here, not a message.
        </p>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap text-[11px] text-fg-faint">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}

/**
 * One mounted page.
 *
 * Keyed by page, mode and role in the parent, so changing any of them
 * remounts everything — a fresh cache, a fresh `AuthProvider`, a fresh first
 * paint. Re-using a client across modes would show yesterday's rows behind
 * today's failure, which is the *warm* case and looks fine; the state worth
 * seeing is the cold one.
 */
function Frame({ page, mode, role }: { page: PageEntry; mode: StubMode; role: StubRole }) {
  const Page = PAGE_COMPONENTS.get(page.name)!;

  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // `paused` needs a retry to exist before it can be held; every
            // other mode should reach its verdict at once rather than
            // spending three backoffs looking like a slow load.
            retry: mode === "paused" ? 1 : 0,
            retryDelay: 1,
            /*
              ⚠ This is why the warm case is unreachable here (M216).

              Nothing is ever stale, so `refetchOnWindowFocus` has nothing
              to refetch and a FAILED REFETCH — good data cached, the next
              read failing — cannot be produced in this gallery. Measured,
              not assumed: forcing /screen-state to 503 and focusing the
              document produced **0 refetch attempts**, so the LIVE badge
              staying put proved nothing at all.

              It stays `Infinity` on purpose. The gallery's job is to hold a
              page still in one state; a background refetch would change the
              state under whoever is looking at it. Building a
              failed-refetch mode is a different instrument, and naming this
              as unreachable is worth more than a green criterion.
            */
            staleTime: Infinity,
          },
        },
      }),
    [mode]
  );


  return (
    <QueryClientProvider client={client}>
      {/*
        A second `AuthProvider` inside the app's own. The inner context wins
        for everything below it, so the page under test reads the stubbed
        role — and reads it through the real provider, so the role branches
        exercised are the page's own rather than a fake context standing in
        for them.
      */}
      <AuthProvider>
        <Caught label={`${page.name}:${mode}:${role}`}>
          <Suspense fallback={<p className="p-6 text-fg-muted">Loading the page…</p>}>
            <Routes>
              {/* Components are lazy-created once in PAGE_COMPONENTS above. */}
              {/* eslint-disable-next-line react-hooks/static-components */}
              <Route path={relative(page.path)} element={<Page />} />
            </Routes>
          </Suspense>
        </Caught>
      </AuthProvider>
    </QueryClientProvider>
  );
}

/**
 * What the stub actually did — the harness's own output (M204).
 *
 * The mode chip says what was *asked for*. This says what was *served*, and
 * the two are not the same claim. `empty` asked for one thing and delivered
 * whatever the server had, for as long as nobody counted — so the count is
 * now on the screen, permanently, rather than being something a person has
 * to think to check.
 *
 * The line a reader needs most is the last one: a request the stub could not
 * answer. It is loud, it names the path, and it is impossible to mistake for
 * a page's own behaviour.
 */
function ServedBanner({ mode, forcedToFail }: { mode: StubMode; forcedToFail: string[] }) {
  const [calls, setCalls] = useState<StubCall[]>(getLedger);

  useEffect(() => {
    watchLedger(() => setCalls(getLedger()));
    return () => watchLedger(null);
  }, []);

  const count = (outcome: StubCall["outcome"]) => calls.filter((c) => c.outcome === outcome).length;
  const uncovered = calls.filter((c) => c.outcome === "uncovered");
  const passthrough = count("passthrough");

  /*
    A forced failure is its own line and is NEVER folded into the served
    counts (M213, and F89's rule). It also reports the endpoints the page
    did not ask for, because a typo in `?fail=` that silently matches
    nothing would render a perfectly clean page under a label claiming a
    failure was injected — the exact "looks like coverage" fault that made
    F89 worse than F86.
  */
  const forcedSeen = new Set(
    calls.filter((c) => c.outcome === "forced-fail").map((c) => c.path)
  );
  /*
    Only meaningful once the page has actually issued something. Before the
    first request every endpoint looks "never called", and a warning that
    fires on first paint and then retracts itself teaches a reader to ignore
    it.
  */
  const neverAsked =
    calls.length > 0 ? forcedToFail.filter((p) => !forcedSeen.has(p)) : [];

  const parts = [
    count("stubbed") && `${count("stubbed")} stubbed`,
    count("emptied") && `${count("emptied")} served empty`,
    passthrough && `${passthrough} from the real server`,
    count("session") && `${count("session")} session`,
  ].filter(Boolean);

  return (
    <div className="mb-3 text-[11px] leading-[1.6]">
      <p className="font-mono tracking-[0.1em] text-fg-faint">
        SERVED BY {mode.toUpperCase()} — {parts.length ? parts.join(" · ") : "no requests yet"}
      </p>

      {/*
        A passthrough outside `ready` would mean the stub was bypassed, which
        is the M204 defect itself. It cannot happen through this file any
        more, so if it ever shows here, something else patched `fetch`.
      */}
      {mode !== "ready" && passthrough > 0 && (
        <p className="mt-1 font-medium" style={{ color: "var(--destructive-soft)" }}>
          {passthrough} request(s) reached the real server in a stubbed mode. This screen is not the
          state you selected — do not report on it.
        </p>
      )}

      {forcedSeen.size > 0 && (
        <p className="mt-1" style={{ color: "var(--accent-soft)" }}>
          Forced to fail on purpose: {[...forcedSeen].join(", ")} — that failure is the harness,
          not the product.
        </p>
      )}

      {neverAsked.length > 0 && (
        <p className="mt-1 font-medium" style={{ color: "#d8a33c" }}>
          This page never called {neverAsked.join(", ")}, so nothing was forced to fail. Whatever
          is below is the ordinary {mode} state — check the path.
        </p>
      )}

      {uncovered.length > 0 && (
        <p className="mt-1" style={{ color: "#d8a33c" }}>
          The stub had no answer for {uncovered.map((c) => c.path).join(", ")} — it refused rather
          than guessing, so this page is showing a failure the harness caused, not one the product
          has. Add the path to EMPTY_ANSWERS with the body its route returns.
        </p>
      )}
    </div>
  );
}

const CHIP = "rounded-full px-3 py-1.5 text-[12px] border";

function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={CHIP}
          style={
            option === value
              ? { borderColor: "var(--accent)", color: "var(--accent)" }
              : { borderColor: "rgba(var(--ink),.16)", color: "rgba(var(--ink-cream),.7)" }
          }
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function PageStates() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();

  const mode = (MODES.find((m) => m === params.get("mode")) ?? "error") as StubMode;
  /*
    `?fail=/nfc-cards` — one endpoint down, everything else up (M213).

    Comma-separated so several can be named, but one at a time is the
    requirement: the state worth reaching is the *mixture*, and a mode that
    fails everything is one we already had.
  */
  const list = (name: string) =>
    (params.get(name) ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);

  const fail = list("fail");
  /** `?empty=/nfc-cards` — force ONE endpoint to succeed with nothing in it. */
  const serveEmpty = list("empty");
  const role = (ROLES.find((r) => r === params.get("role")) ?? "admin") as StubRole;

  /*
    Which page is showing is decided by the address, not by a piece of state
    beside it — so a state that turns out to be wrong can be handed over as a
    link that shows it, and comes back the same after a reload.
  */
  const here = location.pathname.slice(BASE.length).replace(/^\//, "") || "/";
  /*
    Longest pattern first, so `contributors/:id/edit` is not swallowed by
    `contributors/:id` — the router's own static-before-dynamic problem,
    which this list has to solve for itself because it is not the router.
  */
  const page =
    [...PAGES]
      .sort((a, b) => relative(b.path).length - relative(a.path).length)
      .find((p) => matches(p.path, here)) ?? PAGES[0];

  const go = (name: string) => {
    const next = PAGES.find((p) => p.name === name);
    if (next) navigate(`${BASE}/${concrete(next.path)}?${params.toString()}`.replace("//", "/"));
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next);
  };

  /*
    The stub is installed here, during render, and torn down only when the
    gallery itself closes. Two ordering facts forced both halves, and each
    was a real bug first.

    **During render, not in an effect.** Effects run child-first, so
    `AuthProvider` — mounted below this — fired its `/auth/session` request
    *before* the stub existed. It hit the real backend, got a 401, and left
    `profile` null. `MyInfoPage` then sat at "Opening…" for ever, because
    its query is `enabled: !!profile?.id` and a disabled query is pending
    for ever. The role selector was decorative: no page was seeing the role
    I had chosen for it.

    **Owned here, not in `Frame`.** With install/remove inside the keyed
    `Frame`, changing page ran the *new* frame's render (installing) before
    the *old* frame's cleanup (removing) — so switching pages silently
    uninstalled the stub and the next page talked to the real backend.
    `PageStates` does not remount between pages, so there is no race.

    Both found by using the harness on M203 and refusing to accept
    "Opening…" as an answer. A side effect in `useMemo` is not ordinarily
    defensible; here the requirement *is* the ordering, and `installStub`
    is idempotent so saying it twice costs nothing.

    **And there is no cleanup, which took three attempts to accept.**
    Effects run child-first — setup *and* cleanup. Under StrictMode React
    mounts effects, unmounts them, and mounts them again, so any cleanup
    here ran before `AuthProvider`'s second setup: the stub came down, the
    provider re-fetched `/auth/session` against the real backend, got
    `profile: null`, and that was the state that survived. `MyInfoPage` sat
    at "Opening…" with **zero requests made**, because its query is
    `enabled: !!profile?.id`.

    A parent simply cannot guarantee, through effects, that something is
    installed while its children's effects run. Render is the only phase
    that precedes all of them. So the install lives in render and nothing
    takes it down.

    Known wart, stated rather than hidden: navigating out of the gallery
    *within* the SPA leaves `window.fetch` patched until a reload. Every
    control here stays inside the gallery, and it is a development page.

    Each of these three was found by measuring rather than reasoning — the
    last one by checking `window.fetch.toString()` for `[native code]` and
    by counting the requests that did not happen.
  */
  useMemo(
    () => installStub({ mode, role, fail, serveEmpty }),
    [mode, role, fail.join(","), serveEmpty.join(",")]
  );
  // The count belongs to one page in one mode, so it restarts with the frame.
  useMemo(
    () => resetLedger(),
    [page.name, mode, role, fail.join(","), serveEmpty.join(",")]
  );

  const admitted = page.allow.includes(role);

  return (
    <div className="min-h-[100dvh]" style={{ background: "#0a0a0a" }}>
      <div className="border-b border-line-soft px-5 py-4">
        <h1 className="text-[18px] font-bold">Admin pages, by state</h1>
        <p className="mt-1 max-w-[620px] text-[12px] leading-[1.6] text-fg-faint">
          The real page, its real queries, only the server's answers replaced.{" "}
          <span style={{ color: "rgba(var(--ink-cream),.75)" }}>error</span> and{" "}
          <span style={{ color: "rgba(var(--ink-cream),.75)" }}>paused</span> need nothing at all — no
          backend, no credential, any width. Those are the two this exists for.{" "}
          <span style={{ color: "rgba(var(--ink-cream),.75)" }}>paused</span> is the real M195 state:
          focus forced false with one retry outstanding, and on every page that reads{" "}
          <code>listState</code> it should be indistinguishable from loading — anything else is a
          finding.
          <br />
          <br />
          <span style={{ color: "rgba(var(--ink-cream),.75)" }}>ready</span> and{" "}
          <span style={{ color: "rgba(var(--ink-cream),.75)" }}>empty</span> pass through to the dev
          backend on :4000, so they show only what <em>this browser's own session</em> is allowed to
          fetch. The stub answers <code>/auth/session</code>, which is what the page believes — it
          is not a cookie, and the backend is not fooled by it. On a signed-out browser these two
          degrade to the failure path for every protected endpoint. That is the session, not the
          page. Empty answers with an empty body written out from the route itself — `[]` for a list, and for the three `/owner` endpoints the object they actually return — and invents nothing else, so a page that
          throws there is throwing on a real payload; a list nested inside an object is left alone.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">PAGE</span>
            <select
              value={page.name}
              onChange={(e) => go(e.target.value)}
              className="w-full max-w-[420px] rounded-lg border border-line-soft bg-transparent px-3 py-2 text-sm"
            >
              {PAGES.map((p) => (
                <option key={p.name} value={p.name} style={{ background: "#0a0a0a" }}>
                  {p.name} — {p.path}
                  {p.allow.length === 1 ? "  (admin only)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">STATE</span>
              <Chips options={MODES} value={mode} onChange={(v) => set("mode", v)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">ROLE</span>
              <Chips options={ROLES} value={role} onChange={(v) => set("role", v)} />
            </div>
          </div>

          {/*
            The guard is not rendered here — the page under test is mounted
            directly, so a role the real route would turn away still draws.
            Said out loud rather than hidden, because a harness that silently
            shows you a page the product would refuse is teaching you the
            wrong thing about the product.
          */}
          {!admitted && (
            <p className="text-[12px]" style={{ color: "#d8a33c" }}>
              The real route turns {role} away from this page ({page.allow.join(" / ")} only). Shown
              anyway — this is what the page would draw, not what the product would do.
            </p>
          )}
        </div>
      </div>

      <div className="p-5">
        <div
          className="min-h-[60vh] rounded-xl p-4"
          style={{ border: "1px dashed rgba(var(--ink),.14)" }}
        >
          <ServedBanner mode={mode} forcedToFail={fail} />
          {/*
            `fail` belongs in the key (M213).

            Without it, changing only `?fail=` left the same QueryClient
            mounted, every query answered from cache, and no request was
            made at all — so the forced failure never fired and the banner
            reported "this page never called /channels" about a page
            rendering eight channels. An instrument that quietly does
            nothing is the F86 shape again, and it was one comma away.
          */}
          <Frame
            key={`${page.name}:${mode}:${role}:${fail.join(",")}:${serveEmpty.join(",")}`}
            page={page}
            mode={mode}
            role={role}
          />
        </div>
      </div>
    </div>
  );
}
