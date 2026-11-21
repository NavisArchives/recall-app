import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  KNOWN_ORPHANS,
  PINNED_LIVE,
  absolute,
  shippedModules,
  trackedSourceFiles,
} from "./shipped";

/**
 * M205 — the number-fabricating shape, forced to be classified.
 *
 * M197 established that the *prose* half of this class cannot be caught by
 * pattern: "The screen has not been on this week" is a false absence claim
 * with no absence words in it. The **numeric** half is different, and that
 * is the whole opportunity here — it has an exact signature:
 *
 *     query data defaulted with `?? []` or `?? 0`, then counted.
 *
 * `(channels ?? []).reduce(…)` renders "0 photographs in the archive" on a
 * shelf that failed to load. It is the same expression that, in M196's Add
 * flow, chose channel number 01 and cost a family their captions.
 *
 * ── Why this lists sites and not findings ────────────────────────────────
 *
 * ⛔ **A shape is not a consequence.** Feedback checked two of the candidate
 * sites on screen and found both already guarded — the page renders its
 * failure state and the count never reaches the screen. Filing twelve
 * tickets would have been twelve claims, most of them wrong.
 *
 * So this test does not assert that any site is a bug. It asserts that
 * **every site has been looked at and classified**, and it is
 * **fail-by-default**: a new one appears as a failure naming the file and
 * the expression, until somebody reads it and writes down which it is.
 *
 * ── Claim granularity, learned the hard way ──────────────────────────────
 *
 * M182's allowlist was keyed by **file**, and `AdminUpload` — exempted for a
 * harmless sentence about picked files — carried a data-loss defect through
 * the exemption unnoticed. `ShelfPage` was exempted with a reason that was
 * simply **false**, and nothing tests a reason.
 *
 * So the key here is `file :: expression`, and the verdict has to name what
 * makes the site safe rather than paraphrase the situation. Change the
 * expression and the key stops matching — which is the point: the reasoning
 * was about that expression, so it has to be re-made.
 */

const ROOT = new URL("../../", import.meta.url).pathname;

/** A site: a defaulted value that is then counted. */
interface Site {
  file: string;
  expression: string;
}

/*
  The boundary was wrong, and M208 is the correction.

  Narrowing 61 → 28 was right: a list nobody can read in one sitting gets
  rubber-stamped, which is how `ShelfPage`'s false exemption survived. But I
  drew the line at **"produces a FIGURE"**, and the consequence class is
  **"produces a CLAIM rendered to a person"** — and I reasoned past the worst
  instance in this codebase *by name*, writing that "`(cards ?? []).map(…)`
  builds a collection; it does not assert a number to a family."

  True about numbers. False about claims. `ShelfPage` built a Set from that
  expression, and a failed NFC read made every tile say **"no card yet"** in
  amber with `aria-label="No card linked"`. Unlike a wrong figure, that tells
  a family to go and physically re-tap cards that already work.

  ── Why this is two lists and not one wider one ──────────────────────────

  Widening `DIRECT` to `.map`/`.filter` puts the population back to 61 and
  the readability problem back with it. So the shape that *asserts a number*
  keeps its own tight patterns, and the shape that *feeds a rendered claim*
  gets its own narrow one: a defaulted read whose result reaches a
  `Set`/`Map` or a membership test. That is the specific mechanism behind
  M208 — a lookup that answers "no" for everything when the lookup is empty
  — rather than every collection operation in the codebase.

  Two names, two counts, one classification map. If either list grows into a
  wall, split it again rather than accepting one nobody reads.
*/

/** `(x ?? []).length`, `(x ?? []).reduce(`, and the same through a chain. */
const DIRECT = /\(([^()]{1,80}\?\?\s*(?:\[\]|0))\)[^;\n]{0,120}?\.\s*(length|reduce)\b/g;

/** `const rows = x ?? [];` — counted somewhere else in the same file. */
const INDIRECT = /const\s+(\w+)\s*=\s*([^;\n]{1,80}\?\?\s*(?:\[\]|0))\s*;/g;

/**
 * M208's shape: a defaulted read turned into a lookup.
 *
 * `new Set((cards ?? []).map(…))` and `new Map((stream?.circle ?? []).map(…))`
 * — the `.has()` or `.get()` that follows answers "no" for every key when
 * the read failed, and a page renders that "no" as a fact about the family's
 * archive. Multi-line by nature, because these are almost always inside a
 * `useMemo`, which is the other reason `INDIRECT` could never have caught
 * the one on the shelf.
 */
const LOOKUP = /new\s+(?:Set|Map)\s*\(\s*\(?[^;]{0,200}?\?\?\s*(?:\[\]|\{\})/gs;

/**
 * A false clear this census gave, found by somebody reading the file (M221).
 *
 * `const waiting = (data?.requests ?? []).filter(…)` and then
 * `waiting.length` in a heading, lines apart. `DIRECT` cannot see it — it
 * refuses newlines, and the count is on another line. `INDIRECT` cannot see
 * it either — it requires the binding to *end* at `?? []`, and this one
 * continues into `.filter(`. So the platform owner's doorstep counted a
 * defaulted read and the census reported the file clean.
 *
 * That is the failure this instrument exists to prevent, landing on the
 * instrument. The narrowing call is the only new thing: a defaulted read
 * that gets filtered or sliced and *then* counted is the same claim with a
 * step in the middle.
 *
 * Still gated on being counted later in the same file, so this adds the
 * shape without reopening the 61-site wall that made the census unreadable.
 */
const NARROWED =
  /const\s+(\w+)\s*=\s*\(([^()]{1,80}\?\?\s*\[\])\)\s*\.\s*(filter|slice|concat)\b/g;

/*
  What ships, and nothing else (M209).

  This walked every `.ts`/`.tsx` on disk with no idea which of them a family
  ever loads, so 2 of its 28 keyed sites were in `Sidebar.tsx` — a file
  nothing has imported since 7 August. That is not 7% waste as a bound; it
  is 7% because one orphan happened to hold one matching shape, and eight
  more orphans could match tomorrow.

  `unknown ⇒ reachable ⇒ still keyed`: when the census cannot be read,
  `shipped` is null and nothing is excluded.
*/
const shipped = shippedModules();

function isDeadCode(rel: string): boolean {
  if (!shipped) return false;
  return (KNOWN_ORPHANS as readonly string[]).includes(rel) && !shipped.has(rel);
}

/**
 * Code only — a comment about this shape is not an instance of it (M221).
 *
 * The census had one site keyed in `ContributorProfilePage.tsx`, and it was
 * **prose**: a block comment I wrote explaining the defect, quoting
 * `(people ?? [])` and `ableAdmins.length` in the same sentence. The regex
 * matched the explanation. The real line three above it —
 * `const ableAdmins = (people ?? []).filter(…)` — was never walked at all.
 *
 * So the file carried a verdict, the verdict read correctly, and it
 * certified a sentence rather than the code. Worse than a plain miss: a
 * phantom site *looks like coverage*, and it is the thing a reviewer checks
 * for before concluding the page is done. It is the banner problem from the
 * states harness in a second instrument — covered, and wrong.
 *
 * Block comments go entirely. Line comments only when the whole line is
 * one, so a `//` inside a string or a URL is left alone — a census that
 * mangles code to avoid mangling comments has traded one blindness for
 * another.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function findSites(): Site[] {
  const sites: Site[] = [];

  for (const rel of trackedSourceFiles(ROOT)) {
    if (isDeadCode(rel)) continue;
    const src = withoutComments(readFileSync(absolute(ROOT, rel), "utf8"));

    for (const [, expr, call] of src.matchAll(DIRECT)) {
      sites.push({ file: rel, expression: `(${expr.trim()}).${call}` });
    }

    for (const [match] of src.matchAll(LOOKUP)) {
      // The whole constructor call is the key: `new Set((cards ?? []).map` —
      // enough to find it again, short enough to read in a list.
      sites.push({ file: rel, expression: match.replace(/\s+/g, " ").slice(0, 60).trim() });
    }

    for (const [, name, expr, call] of src.matchAll(NARROWED)) {
      const counted = new RegExp(`\\b${name}\\s*\\.\\s*(length|reduce)\\b`).test(src);
      if (counted) sites.push({ file: rel, expression: `const ${name} = (${expr.trim()}).${call}` });
    }

    for (const [, name, expr] of src.matchAll(INDIRECT)) {
      // Counted later in the same file, or it is not this shape at all.
      const counted = new RegExp(`\\b${name}\\s*\\.\\s*(length|reduce)\\b`).test(src);
      if (counted) sites.push({ file: rel, expression: `const ${name} = ${expr.trim()}` });
    }
  }

  /*
    Deduped by key. The same expression twice in one file is one piece of
    reasoning, not two — and a `Record` cannot hold a repeated key anyway,
    which would have silently dropped one of them.
  */
  const seen = new Set<string>();
  return sites
    .filter((s) => {
      const key = `${s.file} :: ${s.expression}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => `${a.file}${a.expression}`.localeCompare(`${b.file}${b.expression}`));
}

type Verdict =
  /** The count cannot reach the screen from a failed or unread load. */
  | "guarded"
  /** Not server data — local state, a constant, a prop already vouched for. */
  | "not-query-data"
  /** Known to fabricate. Must be empty, or carry an open mission number. */
  | "fabricates";

/**
 * Every site, with the reason that makes it what it is.
 *
 * "guarded" must name **what** guards it — a door, a `listState`, an
 * `isPending` gate — not merely assert that something does. That is the
 * `ShelfPage` lesson: a reason nothing executes is a reason nobody checks.
 */
const guarded = (why: string) => ({ verdict: "guarded" as const, why });

const CLASSIFIED: Record<string, { verdict: Verdict; why: string }> = {
  // ── Overview, the workspace's front page ───────────────────────────────
  // These four were MEASURED fabricating: "0 Channels · 0 Photographs ·
  // 0 Contributors" at 40px, "0 of 0" linked, "0 of 0 done", "None this
  // week" — beside the same page in `ready` reading 8, 10, 5.
  "components/admin/OverviewMasthead.tsx :: const all = channels ?? []": guarded(
    "Rendered as `shelfUnread ? '—' : all.length`; `shelfUnread` is the channels query's own isPending||isError."
  ),
  "components/admin/OverviewMasthead.tsx :: (people ?? []).length": guarded(
    "Rendered as `peopleUnread ? '—' : contributors`, gated on the people query alone."
  ),
  "components/admin/OverviewMasthead.tsx :: const allCards = cards ?? []": guarded(
    "The NFC pill renders `cardsUnread ? '—' : `${linked} of ${allCards.length}``."
  ),
  "components/admin/OverviewMasthead.tsx :: (missions ?? []).length": guarded(
    "`missionsUnread ? '—' : `${doneMissions} of ${totalMissions} done``, and the bar's width is forced to 0%."
  ),
  "components/admin/OverviewBento.tsx :: (cards ?? []).length": guarded(
    "`cardsUnread` replaces the whole 'n of m linked' line with a sentence saying the cards could not be read."
  ),
  "components/admin/OverviewBento.tsx :: const rows = missions ?? []": guarded(
    "`total`/`percent` only reach the screen through `missionsUnread ? '—' : …` at both render sites."
  ),

  // ── Counts that never reach the screen from a bad load ─────────────────
  "components/admin/HeaderBell.tsx :: (suggestions?.groups ?? []).reduce": guarded(
    "The dot renders only on `waiting > 0`, so a failed load draws nothing; the aria-label now says 'Open Missions' while `unread`, instead of 'Nothing needs attention'."
  ),
  "components/admin/TopNav.tsx :: (missions ?? []).length": guarded(
    "`{item.badge ? … : null}` — a zero badge renders nothing at all, so no figure is asserted."
  ),
  /*
    `Sidebar.tsx` used to carry two verdicts here. It is imported by nobody
    and is now excluded from the walk by name (M209, `KNOWN_ORPHANS`), so
    its verdicts have gone with it — a sentence about code nothing walks is
    the same unexercised confidence that let `ShelfPage`'s false exemption
    stand for months.

    That file is the reason M209 exists: orphaned on 7 August, then given
    three separate corrections in thirteen days — this backstop's own first
    finding, M191's, and mine — none of which could reach a family.
  */

  // ── Insights, both forks ───────────────────────────────────────────────
  "pages/admin/InsightsPage.tsx :: (channels ?? []).reduce": guarded(
    "F87 itself. The Additions card renders `channelsUnread ? '—' : photographs`."
  ),
  "mobile/MobileInsights.tsx :: (channels ?? []).reduce": guarded(
    "F87's fork, fixed identically — the twin is why the desktop fix alone was not the fix."
  ),
  "pages/admin/InsightsPage.tsx :: const returns = insights?.most_visited ?? []": guarded(
    "`returnsState = listState({ isPending, isError, count: returns.length })` decides every branch."
  ),
  "mobile/MobileInsights.tsx :: const returns = insights?.most_visited ?? []": guarded(
    "Same `returnsState` as the desktop fork."
  ),

  // ── Lists that consult their own failure ───────────────────────────────
  "mobile/MobileShelf.tsx :: const rows = channels ?? []": guarded(
    "The 'N CHANNELS' count is suppressed entirely while `channelsPending || channelsFailed`."
  ),
  "pages/admin/ShelfPage.tsx :: const all = channels ?? []": guarded(
    "Header figures render only when `!isLoading && !channelsFailed`; the grid and 'No channel matches that.' sit behind the same condition."
  ),
  "pages/admin/UsersPage.tsx :: const members = (people ?? []).filter": guarded(
    "The archive card's people count. `members.length` is only rendered inside " +
      "`peopleState === \"ready\"`; the error branch says 'The people could not be loaded.' in " +
      "words, and the face chips are gated on the same state — so a failed roster read can " +
      "never describe the family as smaller than it is."
  ),
  "pages/owner/OwnerDashboard.tsx :: const rows = data?.requests ?? []": guarded(
    "The hardware-request queue (052). `rows.length` renders only inside " +
      "`!isPending && !isError`, and the header sentence names the failed read in words " +
      "('the requests could not be read') before the count is ever consulted — so a broken " +
      "read can never say 'nobody waiting', which is the sentence that would stop the owner " +
      "looking at the one list a family is waiting on."
  ),
  "pages/owner/OwnerDashboard.tsx :: const cards = data?.cards ?? []": guarded(
    "18j's fulfilment queue. `cards.length` is only ever read inside " +
      "`!isPending && !isError`, and the header sentence branches on those two " +
      "before it reaches the count — so a failed read says 'the queue could not " +
      "be read', never 'nothing waiting'. That distinction is the whole value of " +
      "the figure: 'nothing waiting' is the one sentence that would stop somebody " +
      "opening this page, and it must never be what a broken read looks like."
  ),
  "pages/admin/CardsPage.tsx :: (channels ?? []).length": guarded(
    "18k's 'no channels yet' screen. Gated on `!channelsPending && !channelsFailed`, so a " +
      "failed channels read can never claim the archive has none — which matters here more " +
      "than most: that screen tells a family to go and make a channel, and it would be " +
      "sending them to make a second one they already have."
  ),
  "pages/admin/CardsPage.tsx :: const allRows = cards ?? []": guarded(
    "Renamed from `rows` when 18a's filters landed: `rows` is now the FILTERED view and " +
      "`allRows` the fleet. Nothing counts either one — the 'n of m linked' subtitle the old " +
      "verdict described has been removed with the rest of the header (18a does not have it), " +
      "so the only reader is `cardsState`, which is listState over allRows and already " +
      "distinguishes pending and failed from empty."
  ),
  "pages/admin/ContributorsPage.tsx :: (channels ?? []).reduce": guarded(
    "The '· N photographs between them' clause renders only when `!channelsPending && !channelsFailed`."
  ),
  "pages/admin/MissionsPage.tsx :: const rows = missions ?? []": guarded(
    "`missionsState` (listState) gates both the body and the '· N done this month' subtitle."
  ),
  "pages/admin/DeletedChannelsPage.tsx :: const rows = channels ?? []": guarded(
    "Both lists feed `combinedListState`, and 'Nothing has been deleted recently.' is only reachable from its 'empty'."
  ),
  "pages/admin/DeletedChannelsPage.tsx :: const fileRows = files ?? []": guarded(
    "The second half of the same `combinedListState` — one failure withdraws the claim about both."
  ),
  "pages/FamilyProfilesPage.tsx :: const profiles = data?.profiles ?? []": guarded(
    "`isPending` (not isLoading) guards the 'no profiles' branch, so a paused retry cannot reach it."
  ),
  "pages/ProfilesPage.tsx :: const others = profiles?.filter((p) => p.role !== \"user\") ?? []": guarded(
    "Same fix: the early return is on `isPending`, so the chooser cannot draw itself empty while the load is unresolved."
  ),
  "pages/Overview.tsx :: const items = channels ?? []": guarded(
    "Margaret's own screen. `isPending` returns before the 'No channels yet.' branch, and `isError` has its own."
  ),

  // ── M208: lookups, where an empty map answers "no" to everything ───────
  "pages/admin/ShelfPage.tsx :: new Set((cards ?? []": guarded(
    "M208 itself. `cardsUnread` is passed to every ChannelTile, which has a " +
      "third state — no 'no card yet', no amber, and an aria-label saying it " +
      "could not be checked. It is not a boolean any more, because a boolean " +
      "cannot say 'we did not ask'."
  ),
  "pages/admin/ContributorsPage.tsx :: new Map((stream?.circle ?? []": guarded(
    "`streamUnread` renders every per-person Stat as '—'. The list itself was " +
      "already guarded; this second read on the same page was not, so each " +
      "card said '0 photographs · 0 channels made' from a request that never " +
      "answered."
  ),
  /*
    ⚠ The verdict this replaces was true of one branch and silent about the
    other, which is the false-exemption shape this instrument exists to
    prevent — landing on the instrument itself.

    It read: "the sheet says 'Somebody else created this' without naming
    anybody." Not naming anybody is sufficient against **misidentification**
    and says nothing about **asserting existence** — and the claim that
    fails is not *who* made it, it is *that anyone did*.
  */
  "mobile/MobileShelf.tsx :: new Map((people ?? []": guarded(
    "Three states, and the verdict has to name all three (M214). " +
      "`created_by` NULL -> 'No one is recorded as having made this, so only " +
      "an administrator can add to it' — it neither asserts a creator nor " +
      "leaves the reader hunting for one. The read failed (`peopleUnread`) -> " +
      "'We could not check who made this' — distinguishable from the first, " +
      "which it was not before. Name found -> unchanged. The failure state " +
      "reaches the component now; `(people ?? [])` alone could not tell a " +
      "failed read from an empty one."
  ),

  /*
    ⚠ This entry used to be keyed `(people ?? []).length` — which is not a
    line of code in this file. It is a phrase inside the block comment three
    lines below, explaining the very defect. The census matched the
    explanation and never walked the code; `withoutComments` is the fix, and
    the key above is the real site.
  */
  "pages/admin/ContributorProfilePage.tsx :: const ableAdmins = (people ?? []).filter": guarded(
    "The count of able admins, and the sentence it produces is a refusal: " +
      "'This is the only admin — make someone else an admin first.' On a " +
      "failed read `(people ?? [])` is empty, so `ableAdmins.length <= 1` " +
      "was true for every administrator alive and the page told each of them " +
      "they were the last one. `isLastAdmin` now begins `!peopleUnread`, so " +
      "the claim needs an answered census before it can be made. It failed " +
      "SAFE — it refused rather than permitted — and it was still a false " +
      "statement about the shape of somebody's family, given as the reason " +
      "they could not act."
  ),

  "components/admin/ScreensBlock.tsx :: const paired = screens ?? []": guarded(
    "`unread = isPending || isError` is checked before either use. Both would " +
      "be claims about the house: `paired.length === 0` prints 'No screen is " +
      "paired' — which on a failed read would send somebody to set up a screen " +
      "they already own, spending the family's one slot — and `hasBrowserScreen` " +
      "decides whether the invitation reads 'Set up a screen' or 'Set up a " +
      "different screen'. On a failed read the section says it could not be read " +
      "and offers nothing at all, which is why the button is inside the same gate " +
      "rather than beside it."
  ),

  // ── Not a load ─────────────────────────────────────────────────────────
  "pages/admin/AskPage.tsx :: (answer?.results ?? []).length": {
    verdict: "not-query-data",
    why:
      "`answer` is the state of a search this person just ran, and the whole block renders inside `{answer && …}`. " +
      "A failed search leaves `answer` null, so the count is unreachable rather than zero.",
  },

  // ── The platform owner's page ──────────────────────────────────────────
  "pages/owner/OwnerDashboard.tsx :: (data?.invitations ?? []).length": guarded(
    "`doorPending || doorFailed` now takes priority; the door's list is a different query from the one M191's gate covers."
  ),
  /*
    ⚠ The reason this replaces was FALSE, and it is the second false
    exemption to land in this file (M221).

    It read: "M191's door: `if (isPending || isError) return <OwnerDoor />`
    runs before any of this renders." Every word of that is true about the
    control flow and it guarded nothing, because `/owner/families` caught
    its own read error and answered **200 with `families: []`** — so
    `isError` was never true and the gate it names was never reached. The
    table rendered "no families exist" during an outage, with a verdict in
    this file certifying it safe.

    That is the ShelfPage lesson in its purest form: an exemption can be
    *structurally accurate* and still be worthless, because a gate is only
    as good as the signal it reads. A reason that names a branch must also
    say what makes the branch reachable.
  */
  "pages/owner/OwnerDashboard.tsx :: const families = data?.families ?? []": guarded(
    "M191's door runs first — `if (isPending || isError) return <OwnerDoor />` " +
      "— AND, since M221, the route it reads gives it something to fire on: " +
      "`/owner/families` answers 503 on a failed read instead of 200 with an " +
      "empty list. Both halves are load-bearing. If that route ever goes back " +
      "to catching its own error, this gate silently stops guarding and this " +
      "verdict silently becomes false again."
  ),
  "pages/owner/OwnerDashboard.tsx :: const waiting = (data?.requests ?? []).filter": guarded(
    "`doorPending || doorFailed` withholds the ASKING count and prints 'This " +
      "could not be loaded, so we cannot say who is asking.' Same dependency as " +
      "the families entry above: `/owner/door` also used to answer 200 with an " +
      "empty list, so this guard was dead code until M221 made the route fail."
  ),
  "pages/owner/OwnerDashboard.tsx :: const live = (data?.invitations ?? []).filter": guarded(
    "The INVITATIONS OUT half of the same pair, guarded by the same `doorFailed` " +
      "and reachable for the same reason."
  ),
  "pages/owner/OwnerDashboard.tsx :: const events = (data?.events ?? []).slice": guarded(
    "The console's LATELY list, the first consumer of `/owner/events`. The empty " +
      "sentence ('New families and screens coming to life appear here') renders only " +
      "inside `!isPending && !isError`, and the failed read says so in words first — " +
      "and the route itself answers 503 on a failed read (M221), so `isError` is " +
      "reachable. A platform that could not be read never looks like a quiet one."
  ),

  // ── Narrowed, then counted ─────────────────────────────────────────────
  // The shape the census could not see until M221. Each one is a defaulted
  // read that gets filtered or sliced and is counted a few lines later.
  "components/admin/ContributionBlock.tsx :: const theirs = (activity ?? []).filter": guarded(
    "`listState({ isPending: activityPending, isError: activityFailed, count: " +
      "theirs.length })` — and 'Nothing added yet.' needs `streamSpeaksForThem` " +
      "on top, so it takes two successful loads to make that claim."
  ),
  "pages/admin/ContributorProfilePage.tsx :: const theirChannels = (channels ?? []).filter": guarded(
    "`!channelsLoading && !channelsFailed && channelCount > 0` — the identity " +
      "line adds 'N channels' only from an answered read, and says nothing at " +
      "all otherwise rather than saying zero."
  ),
  "pages/admin/ContributorsPage.tsx :: const contributors = (people ?? []).filter": guarded(
    "`!isLoading && !isError && contributors.length === 0` gates 'No " +
      "contributors yet.' — the sentence that would have invited an admin to " +
      "re-create people who already exist."
  ),
  "pages/admin/EditChannel.tsx :: const co_authors = (people ?? []).filter": guarded(
    "`listState({ isPending: peopleLoading, isError: peopleFailed, count: " +
      "co_authors.length })` (M181/F70). Here a false 'No co-authors yet.' " +
      "narrows who a memory can be shared with, which is why it has its own gate."
  ),
  "mobile/OverviewTiles.tsx :: (people ?? []).length": guarded(
    "The Contributors tile's fact returns null while `peoplePending || peopleFailed`, and the tile then shows its plain description — no count reaches the screen from an unanswered load."
  ),
  "mobile/OverviewTiles.tsx :: const all = cards ?? []": guarded(
    "The Cards tile's fact returns null while `cardsPending || cardsFailed`, and null again for an empty list; only a real, answered list is counted."
  ),
  "mobile/MobileOverview.tsx :: const all = channels ?? []": guarded(
    "The phone masthead renders `shelfUnread ? '—' : all.length` and the same for photographs; `shelfUnread` is the channels query's own isPending||isError."
  ),
  "mobile/MobileOverview.tsx :: (people ?? []).length": guarded(
    "Rendered as `peopleUnread ? '—' : contributors`, gated on the people query alone — the desktop masthead's rule, at phone size."
  ),
  "mobile/MobileOverview.tsx :: const open = (missions ?? []).filter": guarded(
    "`listState({ isPending: missionsPending, isError: missionsFailed, count: " +
      "open.length })` — M197's own site, the one that said 'Nothing waiting' " +
      "on the screen the family sees most."
  ),
  "pages/Social.tsx :: const others = (people ?? []).filter": guarded(
    "`isPending` and `isError` both return before the `others.length === 0` " +
      "branch, so 'Nobody here just yet.' — on Margaret's own screen, about " +
      "her whole family — needs evidence of success behind it."
  ),

  // ── Narrowed, and it offers rather than asserts ────────────────────────
  /*
    These two count a defaulted read and the count only decides whether to
    OFFER something. A failed read hides the offer; it never produces a
    sentence about the archive. That is a different verdict from "guarded",
    and writing it as guarded would have meant inventing a gate that is not
    there — so it is recorded as what it is.

    (ChannelNotFound's own entry lived here until 24g folded that screen into
    Overview — the census walks Overview's site now, and a verdict for code
    that no longer exists is phantom coverage, so it went with the code.)
  */
};

/**
 * M209 — the exclusion has to earn itself, before it is used.
 *
 * These run first on purpose. A census that saw nothing would report the
 * whole codebase dead, every exclusion would be "correct" against an empty
 * set, and the backstop would go green while walking nothing at all — the
 * exact silence it exists to prevent, dressed as a pass.
 */
describe("what ships, established before anything is excluded", () => {
  const shippedNow = shippedModules();

  it("can see the files we know are live", () => {
    /*
      The positive control. If the census cannot find `main.tsx`, it cannot
      be trusted to say `Sidebar.tsx` is absent — absence only means
      something once presence has been demonstrated on the same instrument.
    */
    expect(shippedNow).not.toBeNull();
    const missing = PINNED_LIVE.filter((f) => !shippedNow!.has(f));
    expect(missing).toEqual([]);
  });

  it("still has every orphan out of the bundle, by name", () => {
    /*
      Both directions fail loudly. A file listed here that starts shipping
      is a stale exclusion; a LIVE file that stops shipping is the dangerous
      one — it would leave the population silently — and it fails here as an
      orphan nobody wrote down.
    */
    const resurrected = KNOWN_ORPHANS.filter((f) => shippedNow!.has(f));
    expect(resurrected).toEqual([]);
  });

  it("reports what it walked and what it skipped", () => {
    const kept = findSites();
    const skipped = KNOWN_ORPHANS.length;
    /*
      Not an assertion about the exact numbers — a refusal to let the
      population silently empty out, because a backstop keying nothing
      passes every test it has. 31 sites at the time of writing: 28 figures
      and 3 lookups (M208), with 9 orphan files skipped (M209) — 3 since
      components/ui/* and lib/utils.ts were deleted (29 Sep 2026, finding 25).
    */
    expect(kept.length).toBeGreaterThan(20);
    expect(skipped).toBe(3);
  });
});

describe("a figure counted from a default is a claim the page cannot support", () => {
  const sites = findSites();

  /*
    The control. Both halves of this file are regexes over source, and a
    regex that stops matching finds nothing — which would make the
    classification assertion pass by having no work to do. So the sweep
    must first be shown to find the shape at all, and to find the one site
    that provably had this defect.
  */
  it("still finds the shape it is looking for", () => {
    expect(sites.length).toBeGreaterThan(5);

    // F87's site, in both forks — the one measured rendering
    // "0 photographs in the archive" on a shelf that had failed to load.
    const f87 = sites.filter((s) => s.expression.includes("channels ?? []"));
    expect(f87.length).toBeGreaterThanOrEqual(2);

    /*
      M208's shape, pinned separately because it is a second pattern and
      would rot on its own. `new Set((cards ?? []).map(…))` on the shelf is
      the site the FIGURE-only version reasoned past by name — if `LOOKUP`
      ever stops matching it, this file quietly returns to the boundary that
      missed it.
    */
    const lookups = sites.filter((s) => s.expression.startsWith("new "));
    expect(lookups.length).toBeGreaterThanOrEqual(3);
    expect(lookups.some((s) => s.file === "pages/admin/ShelfPage.tsx")).toBe(true);
  });

  it("has a verdict for every site that counts a default", () => {
    const unclassified = sites
      .map((s) => `${s.file} :: ${s.expression}`)
      .filter((key) => !(key in CLASSIFIED));

    /*
      If this fails, each line is a place where a page defaults server data
      and then counts it. That is not a bug by itself — read the site and
      decide:

        guarded         the count cannot reach the screen from a failed or
                        unread load. Say WHAT guards it.
        not-query-data  it is local state or a constant, not a load.
        fabricates      it renders a number the page does not have. Fix it,
                        or record it with the mission that will.

      Do not widen the patterns to make this pass.
    */
    expect(unclassified).toEqual([]);
  });

  /*
    M209 left two `Sidebar.tsx` verdicts behind, describing a file no longer
    in the population. A verdict about code nobody walks is exactly the kind
    of confident, unexercised sentence that made `ShelfPage`'s false
    exemption survive — so stale keys are an error, not tidy-up.
  */
  it("has no verdict for a site it no longer walks", () => {
    const walked = new Set(sites.map((s) => `${s.file} :: ${s.expression}`));
    const stale = Object.keys(CLASSIFIED).filter((key) => !walked.has(key));
    expect(stale).toEqual([]);
  });

  it("has nothing left that knowingly fabricates", () => {
    const fabricating = Object.entries(CLASSIFIED)
      .filter(([, v]) => v.verdict === "fabricates")
      .map(([key, v]) => `${key} — ${v.why}`);
    expect(fabricating).toEqual([]);
  });
});
