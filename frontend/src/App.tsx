import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Header } from "@/components/Header";
import { AuthGuard } from "@/components/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { configureTracking } from "@/lib/sessionTracker";

/*
 * Two loading strategies, because this is two products (M44's split, again).
 *
 * The **display** is a kiosk in a living room that navigates by NFC scan and
 * must keep working with no internet — a lazy chunk is a network request at
 * navigation time, so every page Margaret's screen can reach ships eagerly
 * in the main bundle. That includes the sign-in and landing pages, which sit
 * on the `/` decision path and must never flash a loader.
 *
 * The **management** surfaces — admin, owner, onboarding, the remote chooser
 * — are used by signed-in people on connected machines. They load on demand,
 * which is most of the bundle: the display's own code stays small enough to
 * arrive fast on the machine that matters.
 */
import { SignInPage } from "@/pages/SignInPage";
import { LandingPage } from "@/pages/onboarding/LandingPage";
import { ProfilesPage } from "@/pages/ProfilesPage";
import { Home } from "@/pages/Home";
import { Channel } from "@/pages/Channel";
import { Overview } from "@/pages/Overview";
import { Social } from "@/pages/Social";

const ReplaceScreenPage = lazy(() =>
  import("@/pages/ReplaceScreenPage").then((m) => ({ default: m.ReplaceScreenPage }))
);
const SignUpPage = lazy(() =>
  import("@/pages/onboarding/SignUpPage").then((m) => ({ default: m.SignUpPage }))
);
const JoinPage = lazy(() =>
  import("@/pages/onboarding/JoinPage").then((m) => ({ default: m.JoinPage }))
);

/*
  The component-states gallery (M190 half 1) — development only.

  Registered behind `import.meta.env.DEV`, so the route does not exist in a
  production build and the module is never bundled. It renders the states a
  live sweep cannot reach without breaking production: a failed load's
  sentence, an empty branch, a sheet that only opens mid-flow, the PIN screen
  in error.
*/
const StatesGallery = import.meta.env.DEV
  ? lazy(() => import("@/dev/StatesGallery").then((m) => ({ default: m.StatesGallery })))
  : null;
/*
  Its sibling for whole pages (M199), guarded identically — and the guard has
  to be on the *import*, not on the `<Route>`. A `lazy()` outside the
  condition is still a live dynamic import, so the chunk is built and shipped
  and only the route is missing: the mistake I made and had to unmake in
  M190. This one matters more than the component gallery did, because it
  carries a `fetch` stub that answers `/auth/session` with an administrator.
  Nothing a family runs may contain that code, and the absence is checked in
  the built artifact, not assumed from this line.
*/
const PageStates = import.meta.env.DEV
  ? lazy(() => import("@/dev/PageStates").then((m) => ({ default: m.PageStates })))
  : null;
const PricingPage = lazy(() =>
  import("@/pages/onboarding/PricingPage").then((m) => ({ default: m.PricingPage }))
);
const PostcardsPage = lazy(() =>
  import("@/pages/onboarding/PostcardsPage").then((m) => ({ default: m.PostcardsPage }))
);
const ArchiveServicePage = lazy(() =>
  import("@/pages/onboarding/ArchiveServicePage").then((m) => ({ default: m.ArchiveServicePage }))
);
const ResearchPage = lazy(() =>
  import("@/pages/onboarding/ResearchPage").then((m) => ({ default: m.ResearchPage }))
);
const RequestInvitePage = lazy(() =>
  import("@/pages/onboarding/RequestInvitePage").then((m) => ({ default: m.RequestInvitePage }))
);
const FoundingInvitePage = lazy(() =>
  import("@/pages/onboarding/FoundingInvitePage").then((m) => ({ default: m.FoundingInvitePage }))
);
const FamilyProfilesPage = lazy(() =>
  import("@/pages/FamilyProfilesPage").then((m) => ({ default: m.FamilyProfilesPage }))
);
const ScreenSetupPage = lazy(() =>
  import("@/pages/ScreenSetupPage").then((m) => ({ default: m.ScreenSetupPage }))
);
const AdminLayout = lazy(() =>
  import("@/layouts/AdminLayout").then((m) => ({ default: m.AdminLayout }))
);
const OverviewPage = lazy(() =>
  import("@/pages/admin/OverviewPage").then((m) => ({ default: m.OverviewPage }))
);
const ShelfPage = lazy(() =>
  import("@/pages/admin/ShelfPage").then((m) => ({ default: m.ShelfPage }))
);
const CardsPage = lazy(() =>
  import("@/pages/admin/CardsPage").then((m) => ({ default: m.CardsPage }))
);
const NewPostcardPage = lazy(() =>
  import("@/pages/admin/NewPostcardPage").then((m) => ({ default: m.NewPostcardPage }))
);
const CardDetailPage = lazy(() =>
  import("@/pages/admin/CardDetailPage").then((m) => ({ default: m.CardDetailPage }))
);
const SchedulePage = lazy(() =>
  import("@/pages/admin/SchedulePage").then((m) => ({ default: m.SchedulePage }))
);
const DevicesPage = lazy(() =>
  import("@/pages/admin/DevicesPage").then((m) => ({ default: m.DevicesPage }))
);
const UsersPage = lazy(() =>
  import("@/pages/admin/UsersPage").then((m) => ({ default: m.UsersPage }))
);
const AskPage = lazy(() =>
  import("@/pages/admin/AskPage").then((m) => ({ default: m.AskPage }))
);
const MissionsPage = lazy(() =>
  import("@/pages/admin/MissionsPage").then((m) => ({ default: m.MissionsPage }))
);
const InsightsPage = lazy(() =>
  import("@/pages/admin/InsightsPage").then((m) => ({ default: m.InsightsPage }))
);
const SettingsPage = lazy(() =>
  import("@/pages/admin/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const MyInfoPage = lazy(() =>
  import("@/pages/admin/MyInfoPage").then((m) => ({ default: m.MyInfoPage }))
);
const ActivityPage = lazy(() =>
  import("@/pages/admin/ActivityPage").then((m) => ({ default: m.ActivityPage }))
);
const DeletedChannelsPage = lazy(() =>
  import("@/pages/admin/DeletedChannelsPage").then((m) => ({ default: m.DeletedChannelsPage }))
);
const ContributorsPage = lazy(() =>
  import("@/pages/admin/ContributorsPage").then((m) => ({ default: m.ContributorsPage }))
);
const InvitePage = lazy(() =>
  import("@/pages/admin/InvitePage").then((m) => ({ default: m.InvitePage }))
);
const OwnerDashboard = lazy(() =>
  import("@/pages/owner/OwnerDashboard").then((m) => ({ default: m.OwnerDashboard }))
);
const ContributorProfilePage = lazy(() =>
  import("@/pages/admin/ContributorProfilePage").then((m) => ({
    default: m.ContributorProfilePage,
  }))
);
const ContributorEditPage = lazy(() =>
  import("@/pages/admin/ContributorEditPage").then((m) => ({ default: m.ContributorEditPage }))
);
const SubjectProfilePage = lazy(() =>
  import("@/pages/admin/SubjectProfilePage").then((m) => ({ default: m.SubjectProfilePage }))
);
const PrivacyPage = lazy(() =>
  import("@/pages/legal/PrivacyPage").then((m) => ({ default: m.PrivacyPage }))
);
const TermsPage = lazy(() =>
  import("@/pages/legal/TermsPage").then((m) => ({ default: m.TermsPage }))
);
const HelpPage = lazy(() =>
  import("@/pages/legal/HelpPage").then((m) => ({ default: m.HelpPage }))
);
const CreateAuthor = lazy(() =>
  import("@/pages/CreateAuthor").then((m) => ({ default: m.CreateAuthor }))
);
const AdminUpload = lazy(() =>
  import("@/pages/AdminUpload").then((m) => ({ default: m.AdminUpload }))
);
const EditChannel = lazy(() =>
  import("@/pages/admin/EditChannel").then((m) => ({ default: m.EditChannel }))
);
const ChannelPreviewPage = lazy(() =>
  import("@/pages/admin/ChannelPreviewPage").then((m) => ({ default: m.ChannelPreviewPage }))
);
/*
 * Recovery is rare and never on the kiosk's path — it is reached from a link
 * in the family's inbox, on a connected machine — so it loads on demand.
 */
const ForgotPasswordPage = lazy(() =>
  import("@/pages/ForgotPasswordPage").then((m) => ({ default: m.ForgotPasswordPage }))
);
const RecoverPasswordPage = lazy(() =>
  import("@/pages/RecoverPasswordPage").then((m) => ({ default: m.RecoverPasswordPage }))
);

/** The display needs a trusted machine, but nobody in particular signed in. */
function Display({ children }: { children: React.ReactNode }) {
  return <AuthGuard requireProfile={false}>{children}</AuthGuard>;
}

/**
 * The bare domain, answered by who is asking (M44).
 *
 * Margaret's screen boots to `/` and must find her display there, untouched
 * — it is the whole product from where she sits, and a marketing page in its
 * place would be a stranger's website appearing in her living room. Every
 * other visitor is a stranger, and used to be sent to a login form for an
 * installation they have never heard of.
 *
 * So the device session decides. Not the profile: the machine is trusted or
 * it is not, and that question is already answered before anyone signs in.
 */
function FrontDoor() {
  const { hasDevice, loading } = useAuth();

  // Nothing at all while it is being decided. A landing page that flashes
  // before her display resolves would be the same intrusion, briefly.
  if (loading) return null;
  if (!hasDevice) return <LandingPage />;
  return <Navigate to="/vision" replace />;
}

/**
 * `/vision` — her screen, at an address of its own (owner, 18 Sep 2026).
 *
 * THE DISPLAY USED TO LIVE AT `/`, and that one fact caused the bug the owner
 * kept hitting: `/` was the marketing page for a stranger and the kiosk for a
 * trusted machine, so pressing the logo on a public page — which went to `/` —
 * dropped anyone on a paired laptop straight into Margaret's display. Their
 * own machine is paired, so it happened to them every time.
 *
 * The two products have two addresses now. `/` is the front door and only
 * ever decides *where you go*; the display renders here and nowhere else.
 *
 * `/` STILL REDIRECTS HERE for a paired machine, which is what keeps her
 * physical screen working: it is pointed at the site root, and after this it
 * arrives at `/vision` by itself rather than needing to be re-pointed. The
 * screen has no address bar, so the redirect is invisible where it matters.
 *
 * A browser with no device session has no business here at all — it would be
 * an empty kiosk — so it goes to the door instead.
 */
function Vision() {
  const { hasDevice, loading } = useAuth();

  if (loading) return null;
  if (!hasDevice) return <Navigate to="/login" replace />;
  return (
    <Display>
      <Home />
    </Display>
  );
}

/**
 * `/profiles` — and the one route that had no guard at all (M79).
 *
 * Two different sessions legitimately arrive here: a **device** session on
 * the family screen, which gets the kiosk chooser, and a **family** session
 * on a phone, which gets the plain list. `AuthGuard` cannot express "either
 * of these" — wrapping the route in it unchanged would bounce every family
 * session, since a family session has no device — so the rule lives here.
 *
 * With *neither*, this used to fall through to the kiosk chooser and answer
 * "here is your family" to a browser it had never met: an orphaned session,
 * or anyone typing the path into a fresh window, got the clock and the
 * sign-out line above nothing to choose.
 *
 * Reading live auth state also closes the case where a session dies *while*
 * the chooser is open — `useAuth` updates, this re-renders, and the same
 * rule carries the person out. No special handling anywhere else.
 */
function Chooser() {
  const { hasDevice, hasFamily, loading } = useAuth();

  // Never flash a chooser before the session has answered. An empty room
  // shown for a moment is still an empty room shown.
  if (loading) return null;
  if (!hasDevice && !hasFamily) return <Navigate to="/login" replace />;

  return hasFamily ? <FamilyProfilesPage /> : <ProfilesPage />;
}

function Admin({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  return <AuthGuard allow={adminOnly ? ["admin"] : ["admin", "co_author"]}>{children}</AuthGuard>;
}

function App() {
  const { pathname } = useLocation();
  const { role, loading } = useAuth();

  // Level 1 and level 2 are deliberately bare: no clock, no channel number,
  // nothing about who lives here before the machine is trusted. The
  // management area brings its own frame.
  const onAdmin = pathname.startsWith("/admin");

  /*
   * `/` is two products, so the header has to fork where the body already
   * does (M84).
   *
   * `FrontDoor` gives a device-less visitor the public landing and a paired
   * kiosk its display. The header was decided by a static path list that
   * treated `/` as one thing, so the kiosk's chrome — channel label, room
   * clock, digit hints — rendered on top of the marketing page for every
   * stranger who found the domain. Two products stacked on one screen.
   *
   * While the session is still resolving, `/` is chromeless too: `FrontDoor`
   * renders nothing during `loading`, and a header floating above an empty
   * body is the flash that gives the collision away.
   */
  /*
    `/` is one product again (18 Sep 2026). It is the landing page, or a
    redirect to `/vision` for a paired machine — either way it never draws the
    kiosk, so it is always bare. The display's chrome now belongs to
    `/vision`, which is not in the list below and therefore keeps it.
  */
  const onFrontDoor = pathname === "/";

  const chromeless =
    pathname.startsWith("/login") ||
    // The two recovery doors are the sign-in page's own corridor and wear the
    // same nothing: no clock, no channel number, no subject's name.
    pathname === "/forgot-password" ||
    pathname === "/recover" ||
    pathname === "/profiles" ||
    pathname === "/welcome" ||
    pathname === "/signup" ||
    pathname === "/join" ||
    // Setup wears the sign-in corridor's nothing, like the doors around it.
    pathname === "/screen-setup" ||
    pathname === "/request" ||
    // The marketing and legal pages wear their own header, like the landing.
    pathname === "/pricing" ||
    pathname === "/postcards" ||
    pathname === "/archive-service" ||
    pathname === "/research" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/help" ||
    pathname.startsWith("/invite/") ||
    // The platform surface is not a family's screen and wears none of its
    // furniture — no subject's name in a header that is not about her.
    pathname === "/owner" ||
    // The dev galleries wear no chrome: they are harnesses, and the kiosk
    // header drawn over them is noise that hides the thing being swept.
    // `startsWith`, because M199's gallery puts the page under test in the
    // path — an exact match covered only the older component gallery, and
    // the header drew straight over the new one.
    pathname.startsWith("/dev/") ||
    // The landing stands alone; the kiosk keeps its chrome, at /vision.
    onFrontDoor ||
    onAdmin;

  // Only Margaret's own use of her screen is measured. Someone signed in to
  // manage the archive is working on it, not living with it.
  useEffect(() => {
    if (loading) return;
    configureTracking(role === null || role === "user");
  }, [role, loading]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {!chromeless && <Header />}

      {/*
        The document's one `main` landmark (M70).

        It lives here, not in the shells, because it is the only element on
        every route: /login and /welcome render no shell at all, so demoting
        this one would leave those pages with no landmark rather than one too
        many. The shells below are scroll containers, and now say so.
      */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {/* Null fallback on purpose: the app's rule everywhere is "nothing
            while it is being decided", and a spinner here would be the first
            place that broke it. Lazy pages are management surfaces on
            connected machines; the wait is a code chunk, not a round trip
            worth announcing. */}
        <Suspense fallback={null}>
        <Routes>
          {/*
           * One sign-in page for both kinds of arrival (M111): a person on
           * their own device, or the family screen being set up. The switcher
           * on the page is the whole difference, and both ask for the family
           * credential — the "installation username" retired with the page
           * that used to live at /login/device, so the old path redirects.
           */}
          <Route path="/login" element={<SignInPage />} />
          <Route path="/login/device" element={<Navigate to="/login" replace />} />
          {/* The emailed replacement-ceremony link opens here, on the new
              screen (M117); nothing happens until its one button is pressed. */}
          <Route path="/login/replace-screen" element={<ReplaceScreenPage />} />
          {/*
           * P1b, both halves. `/recover` is the address the recovery email has
           * been sending families to since migration 027 — it must keep that
           * exact path, because links already in inboxes point at it.
           */}
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/recover" element={<RecoverPasswordPage />} />
          {/*
           * The public front door, frame 15a. It lives at /welcome rather than
           * / because / is Margaret's display and she is using it: M44 moves
           * it once the session routing exists to tell a trusted device from a
           * stranger, and not before.
           */}
          <Route path="/welcome" element={<LandingPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/join" element={<JoinPage />} />

          {StatesGallery && <Route path="/dev/states" element={<StatesGallery />} />}
          {/* Splat: the page under test matches on the rest of the path, so
              each state is its own address. */}
          {PageStates && <Route path="/dev/pages/*" element={<PageStates />} />}
          {/*
           * One path, two rooms. A family session is a person on a phone
           * somewhere else, so they get the plain list; the family screen has
           * no family session and keeps the chooser it was designed as, with
           * her face on it.
           */}
          <Route path="/profiles" element={<Chooser />} />
        <Route path="/screen-setup" element={<ScreenSetupPage />} />

          {/*
           * The platform owner's surface (M55) — mine, not a family's.
           *
           * No guard here on purpose: the backend answers 404 to anyone who
           * is not the platform owner, so a family admin who guesses this
           * path gets a page that says "Nothing here" and learns nothing
           * else. Putting the check in the router would mean the frontend
           * knowing who the platform owner is, which is exactly the fact
           * worth not shipping to browsers.
           */}
          <Route path="/owner" element={<OwnerDashboard />} />

          {/* The front door, or her display — decided by the device session. */}
          <Route path="/" element={<FrontDoor />} />
          <Route path="/vision" element={<Vision />} />
          <Route path="/request" element={<RequestInvitePage />} />
          <Route path="/pricing" element={<PricingPage />} />
          <Route path="/postcards" element={<PostcardsPage />} />
          <Route path="/archive-service" element={<ArchiveServicePage />} />
          <Route path="/research" element={<ResearchPage />} />
          {/* The three pages a stranger is owed before any money moves (launch
              sweep): what we keep, what we promise, and who answers. */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/invite/:token" element={<FoundingInvitePage />} />
          <Route path="/channel/:number" element={<Display><Channel /></Display>} />
          <Route path="/overview" element={<Display><Overview /></Display>} />
          <Route path="/social" element={<Display><Social /></Display>} />

          {/* Management — one shell, tabs inside it */}
          <Route
            path="/admin"
            element={
              <Admin>
                <AdminLayout />
              </Admin>
            }
          >
            <Route index element={<OverviewPage />} />
            <Route path="shelf" element={<ShelfPage />} />
            <Route path="missions" element={<MissionsPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="activity" element={<ActivityPage />} />
            {/* The subject's profile. The path says "profile" because the
                page has always been generic — it renders whoever /settings
                says the archive is for. "margaret" survives as a redirect
                so her family's bookmarks keep working. */}
            <Route path="profile" element={<SubjectProfilePage />} />
            <Route path="margaret" element={<Navigate to="/admin/profile" replace />} />
            <Route path="edit-channel/:id" element={<EditChannel />} />
            {/* Seeing a channel is not editing it (M147): a read-only
                preview a remote family session can open, unlike the
                device-guarded display route. */}
            <Route path="channels/:id/preview" element={<ChannelPreviewPage />} />
            <Route path="create-channel" element={<AdminUpload />} />

            <Route path="cards" element={<Admin><CardsPage /></Admin>} />
            {/* 18b–18g: making a postcard is its own corridor, not a modal. */}
            <Route path="cards/new" element={<Admin><NewPostcardPage /></Admin>} />
            <Route path="cards/schedule" element={<Admin><SchedulePage /></Admin>} />
            <Route path="devices" element={<Admin adminOnly><DevicesPage /></Admin>} />
            <Route path="users" element={<Admin><UsersPage /></Admin>} />
            <Route path="cards/:id" element={<Admin><CardDetailPage /></Admin>} />
            <Route path="insights" element={<Admin><InsightsPage /></Admin>} />
            <Route path="my-info" element={<Admin><MyInfoPage /></Admin>} />
            <Route path="settings" element={<Admin adminOnly><SettingsPage /></Admin>} />
            <Route
              path="channels/deleted"
              element={<Admin adminOnly><DeletedChannelsPage /></Admin>}
            />
            <Route path="contributors" element={<Admin><ContributorsPage /></Admin>} />
            {/* Static before dynamic, so "invite" is never read as an id. */}
            <Route path="contributors/invite" element={<Admin adminOnly><InvitePage /></Admin>} />
            <Route
              path="contributors/:id"
              element={<Admin><ContributorProfilePage /></Admin>}
            />
            <Route
              path="contributors/:id/edit"
              element={<Admin adminOnly><ContributorEditPage /></Admin>}
            />
            <Route path="create-author" element={<Admin adminOnly><CreateAuthor /></Admin>} />

            {/* Paths that moved */}
            <Route path="channels" element={<Navigate to="/admin/shelf" replace />} />
            <Route path="archived" element={<Navigate to="/admin/channels/deleted" replace />} />
            <Route path="create-entry" element={<Navigate to="/admin/create-channel" replace />} />
            <Route path="margaret/edit" element={<Navigate to="/admin/settings" replace />} />
            <Route path="observations" element={<Navigate to="/admin/insights" replace />} />

            {/* A mistyped management URL goes to the dashboard, not to a
                blank page explaining URLs to somebody. */}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>

          {/* And anything else goes home — the display's own front door. It
              is a kiosk: an error page there is a dead screen in a living
              room, and nobody in that room can read a stack trace. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
