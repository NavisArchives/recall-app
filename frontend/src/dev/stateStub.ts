import { focusManager } from "@tanstack/react-query";

/**
 * M199 — putting a real admin page into a state production cannot show.
 *
 * Feedback declined to take the owner's PIN through a tool channel, and was
 * right to: an authorisation relayed is not an authorisation given. But that
 * left nineteen profile-gated pages that nobody could look at in any state
 * except the one the live database happens to be in. A credential would have
 * unblocked one sweep. This unblocks every future one, for any seat, at any
 * width, with no credential in play.
 *
 * ── Why the stub sits on `fetch` and not on the query cache ──────────────
 *
 * Seeding `queryClient.setQueryData` would mean knowing every page's query
 * keys — nineteen pages, several keys each, and a new page tomorrow that
 * this harness would silently not cover. A harness with an unwalked page is
 * the same failure as M197's unwalked directory: silence that looks like a
 * pass.
 *
 * Every page reaches the server through `api` in `lib/api.ts`, which is one
 * `fetch` call. Standing in front of that covers all nineteen and every page
 * written after them, without naming any of them.
 *
 * ── M204: nothing falls through in silence ───────────────────────────────
 *
 * The first `empty` mode **did not intercept at all**. It called the real
 * server and blanked top-level arrays in the reply, which was deliberate and
 * documented — and still wrong, because *the label said `empty` and the
 * screen showed whatever the server sent*. Feedback caught it by counting
 * requests rather than reading screens, and was one step from filing "pages
 * treat empty as failure" as a product bug: its session 401s, so every page
 * correctly rendered **failure** under a label saying **empty**.
 *
 * The asymmetry is what makes it serious, and it is the opposite of lucky
 * for whoever comes next. **No session → obviously wrong screens → someone
 * notices. A working session → real, populated data labelled `empty`, with
 * nothing anywhere saying the stub was never consulted.** The person best
 * equipped to be fooled is the one who set the harness up properly.
 *
 * So, the rule this file now keeps — the same one M182's backstop and M197's
 * holes taught, turned on the tool instead of the product:
 *
 *   **In a stubbed mode, every request is answered by the stub or is
 *   reported as uncovered. Deferring quietly to the network is not an
 *   option the code has.**
 *
 * ── Why `empty` cannot simply "invent nothing" ───────────────────────────
 *
 * There was a real design conflict here and it is worth stating, because the
 * obvious fix is wrong in a way that already cost a day. An earlier `empty`
 * invented payloads — `[]` for most paths, `{}` for a hand-kept list of
 * "object endpoints" — and **five pages threw, all five my fault**: a page
 * handed `[]` where the server sends a subject dies on `undefined.split`,
 * which says nothing about how it behaves when the archive is empty. Five
 * false alarms is M197's rejected detector again.
 *
 * The resolution is to invent only where the shape is *known*, and to be
 * **loud** everywhere else rather than guessing in either direction:
 *
 *   known list endpoint  →  `[]`, which is exactly what "empty" means
 *   anything else        →  **uncovered**: the request fails with a
 *                           distinctive error, is counted, and is named in
 *                           the harness's own banner
 *
 * That makes `KNOWN_LISTS` self-maintaining rather than stale. A hand list
 * rots when the things it omits are silent; this one omits nothing quietly,
 * because the harness tells you what it could not answer.
 */
export type StubMode = "ready" | "empty" | "error" | "notfound" | "paused";
export type StubRole = "admin" | "co_author" | "user";

interface Active {
  mode: StubMode;
  role: StubRole;
  /**
   * One endpoint forced to fail while every other one succeeds (M213).
   *
   * The gap this closes: *"one page, several queries, only one of them
   * guarded"* has been found three times, by three people, always by
   * accident — and the harness could never produce it deliberately, because
   * `empty` fails only non-list endpoints and every mode fails *everything*
   * at once. "List A failed while list B succeeded" was unproducible, and
   * that is exactly the sub-class nobody has ever tested.
   *
   * The point is the **mixture**. A state where everything fails is a state
   * we can already reach and is not the one that hides these defects: the
   * defect is one query's failure being narrated by another query's success.
   */
  fail?: string[];
  /**
   * One endpoint forced to SUCCEED as an empty list, even in `ready` (M213).
   *
   * The sibling of `fail`, and it exists because three fixes for this class
   * are source-verified only. Seeing M208's shelf fix needs channels with
   * data AND a card read that *succeeds* — and this browser's session gets
   * 401 on `/nfc-cards` whatever the harness does, so the honest state is
   * all anyone can reach and the contrast is not.
   *
   * "A fix nobody can see is indistinguishable from a fix that doesn't
   * work." Without the contrast, "no card label at all" could equally mean
   * the label is broken.
   *
   * Same discipline as `empty` mode (M204/M207): it invents `[]` only for a
   * KNOWN list, and refuses loudly for anything else rather than guessing a
   * shape — which is the fault that made five pages look broken once.
   */
  serveEmpty?: string[];
}

/** What the stub did with one request — the harness's own output (M204). */
export type Outcome =
  | "session" // /auth/session, answered in every mode
  | "stubbed" // the mode answered it
  | "emptied" // a known list, served as []
  | "passthrough" // `ready` only, and only ever `ready`
  | "forced-fail" // named by ?fail= — never counted as served (M213)
  | "uncovered"; // the stub had no answer — loud, never silent

export interface StubCall {
  path: string;
  outcome: Outcome;
}

let active: Active | null = null;
let realFetch: typeof window.fetch | null = null;
let ledger: StubCall[] = [];
let onLedgerChange: (() => void) | null = null;

/**
 * What "nothing here yet" looks like, per endpoint — **transcribed** from
 * the route that answers it, never derived from the path.
 *
 * This was a list of nine paths all served as `[]`, and eight of them
 * return a bare array so that was right. **`/owner/families` does not.**
 * It answers `{ families, database }` (`backend/src/routes/owner.ts:218`),
 * so the harness would have served an array to a page that reads
 * `data.families`, and the banner would have called it `emptied` — the
 * exact fault named twenty lines below as the worst thing this stub can do,
 * sitting in the list the whole time. It never fired because `/owner` was
 * not in the gallery until M221 put it there.
 *
 * A path cannot tell you a shape. So the shape is written out here, copied
 * from the route's own `res.json`, with the file and line it came from. A
 * transcription can be checked against its source in one look; an inference
 * cannot be checked at all.
 *
 * Still deliberately incomplete. Anything missing is reported as
 * `uncovered` rather than guessed at, so the harness names its own gaps
 * instead of quietly filling them.
 */
const EMPTY_ANSWERS: Record<string, unknown> = {
  "/channels/archived/list": [],
  "/media-files/archived/list": [],
  "/channels": [],
  "/people": [],
  "/missions": [],
  "/nfc-cards": [],
  "/activity": [],
  "/suggestions": [],
  // routes/owner.ts:218 — `res.json({ families: rows, database: "up" })`.
  // A platform with no families yet is launch day, not a fault, so the
  // database it just read successfully says so.
  "/owner/families": { families: [], database: "up" },
  // routes/settings.ts — the screens list. A family with nothing paired is a
  // real and common state, and the one the block must never invent.
  "/settings/screens": [],
  // routes/settings.ts — device requests (052): a bare array, and a family
  // that has never asked for hardware is the common state.
  "/settings/device-requests": [],
  /*
    routes/settings.ts:56 — `if (!data) return res.json(null)`. An archive
    with no subject row yet answers a literal `null`, which is why this one
    is not `{}`: the page's "no subject yet" branch keys on null, and an
    empty object would send it down the wrong path entirely.

    Both of these are here so the Settings page can be looked at at all in
    `empty`. Without them it refused at its first read and no section below
    the subject card ever rendered — the screens list included.
  */
  "/settings": null,
  // routes/settings.ts:110 — a laptop with no mail credentials, which is
  // also exactly what production is today.
  "/settings/email": { from: null, configured: false },
  // routes/owner.ts — the doorstep's success body, with both lists empty.
  "/owner/door": { requests: [], invitations: [], database: "up" },
  /*
    routes/owner.ts — the fulfilment queue (18j) with nothing in it.

    `oldest` is null, not a date: it is the age of the first row, and there
    is no first row. The two counts are genuine zeros for the same reason
    `/owner/health` uses zeros — nothing waiting and could-not-read are
    different answers, and the queue's header sentence branches on exactly
    that difference. A stub that invented a date here would make the empty
    state indistinguishable from a stale queue.
  */
  "/owner/fulfilment": { queued: 0, inFlight: 0, oldest: null, cards: [] },
  // routes/owner.ts — hardware the families asked for (052), nobody waiting.
  // `waiting` is the route's own count of the rows, so zero beside `[]`.
  "/owner/device-requests": { waiting: 0, requests: [] },
  // routes/owner.ts — what has happened lately: a platform on which nothing
  // has happened yet, from a database that answered.
  "/owner/events": { events: [], database: "up" },
  // routes/owner.ts — the health body when the probe is up and every count
  // is a genuine zero. Zero and null are different answers on this page and
  // the difference is the whole of M221, so the *empty* state must be the
  // zeros: nulls here would make the harness unable to tell them apart.
  "/owner/health": {
    database: "up",
    detail: null,
    families: 0,
    memories: 0,
    subscriptions: 0,
    errors_24h: 0,
    storage: null,
  },
};

/**
 * Exact match only — a sub-path is a different resource (F89/M207).
 *
 * This read `path === p || path.startsWith(`${p}/`)`, and the prefix half
 * was quietly catastrophic: **`/people/dev-id` matched `/people` and was
 * served `[]`** — but that endpoint returns **one person object**. The page
 * received an array where it expected a record, `person.name` came back
 * `undefined`, and `InitialsAvatar` died on `.split()`. Three pages rendered
 * a blank screen, and a mission was very nearly cut against
 * `InitialsAvatar` for a crash the harness had manufactured.
 *
 * It is the five-false-alarms trap reintroduced. Payload synthesis was
 * removed from `empty` precisely so the stub could not invent a shape — and
 * the prefix rule put the invention back for sub-resources only, where it
 * was hardest to see.
 *
 * ⚠ **And it is worse than F86, which is why it outranks the crash.** F86
 * was the stub *not answering* — a silent fallthrough. This was the stub
 * answering **confidently with the wrong shape** and reporting it as
 * `emptied`, so the banner read "3 served as []" and looked like correct
 * coverage. An operator cannot tell a legitimately-emptied list from an
 * object flattened into one. The banner is what makes every reading in this
 * harness trustworthy; a case where it says *covered* and is wrong attacks
 * the instrument's whole warrant.
 *
 * The sub-resources the old rule swallowed, named rather than left implied:
 *
 *   `/people`    →  `/people/{id}`            one Author
 *   `/channels`  →  `/channels/detail/{id}`   one channel with its media
 *   `/missions`  →  `/missions/{id}`
 *   `/nfc-cards` →  `/nfc-cards/{id}`
 *
 * `/channels/archived/list` and `/media-files/archived/list` are genuine
 * lists and carry their own entries, so exact matching keeps them.
 *
 * It was called `isKnownList` while it answered for `/owner/health`, which
 * is not a list and never was — the name was the last place the old
 * "a path implies an array" assumption was still written down.
 *
 * Anything not listed now lands in `uncovered`, where the harness already
 * knows how to be loud — which is the correct answer for an object endpoint
 * in a mode that has no meaning for objects.
 */
export function hasEmptyAnswer(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(EMPTY_ANSWERS, path);
}

/** The written-out empty body, so the suite can check it against the route. */
export function emptyAnswerFor(path: string): unknown {
  return EMPTY_ANSWERS[path];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function record(path: string, outcome: Outcome): void {
  ledger = [...ledger, { path, outcome }];
  onLedgerChange?.();
}

/**
 * The session answer, given in every mode.
 *
 * Without this the page under test would fail its own guard before it
 * rendered anything, and the harness would only ever show the sign-in
 * redirect. It is also how `role` reaches the page: the real `AuthProvider`
 * runs unmodified and simply believes this, so the role branches under test
 * are the page's own, not a fake context standing in for them.
 */
function sessionFor(role: StubRole): unknown {
  return {
    device: true,
    family: true,
    profile: {
      id: "dev-profile",
      name: role === "admin" ? "Dev Admin" : role === "co_author" ? "Dev Co-author" : "Margaret",
      role,
    },
  };
}

async function stubbed(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const marker = url.indexOf("/api/");

  // Anything that is not a backend call — a media URL, a source map — goes
  // straight through untouched, and is not the harness's business.
  if (!active || marker === -1) return realFetch!(input, init);

  const path = url.slice(marker + "/api".length).split("?")[0];

  /*
    The forced failure is checked FIRST, before the mode and before the
    session shortcut, and it is recorded as its own outcome (M213).

    F89's lesson applied ahead of time: an endpoint the harness broke on
    purpose must never appear in the banner as "served". A reader who cannot
    tell a forced failure from a real one is reading a screen whose state
    they did not select — which is the fault M204 and M207 both were.
  */
  if (active.fail?.includes(path)) {
    record(path, "forced-fail");
    return json({ error: `Forced to fail by the states harness: ${path}` }, 503);
  }

  /*
    Forced success, checked next: it is the other half of the mixture, and
    like `fail` it must be visible in the banner rather than blending into
    whatever the mode would have done.
  */
  if (active.serveEmpty?.includes(path)) {
    if (hasEmptyAnswer(path)) {
      record(path, "emptied");
      return json(EMPTY_ANSWERS[path]);
    }
    record(path, "uncovered");
    throw new Error(
      `?empty=${path} asks the harness to invent a shape it does not know. ` +
        `Only endpoints in EMPTY_ANSWERS have a written-out empty body.`
    );
  }

  if (path.startsWith("/auth/session")) {
    record(path, "session");
    return json(sessionFor(active.role));
  }

  switch (active.mode) {
    /*
      `ready` is the one mode whose definition IS the real server, so its
      passthrough is honest — and it is recorded as a passthrough so the
      banner can say so, rather than leaving the reader to remember.
    */
    case "ready":
      record(path, "passthrough");
      return realFetch!(input, init);

    case "empty":
      if (hasEmptyAnswer(path)) {
        record(path, "emptied");
        return json(EMPTY_ANSWERS[path]);
      }
      record(path, "uncovered");
      throw new Error(
        `The states harness has no empty answer for ${path}. It did NOT ask the server — ` +
          `a guessed shape is how five pages were wrongly blamed once already. ` +
          `Add it to EMPTY_ANSWERS in dev/stateStub.ts, copying the empty body ` +
          `from the route's own res.json.`
      );

    /*
      404 is a different answer from 503, and M201 is the whole reason this
      mode exists.

      Three pages said "not found" for every failure. Fixing that means the
      *other* branch has to stay reachable too — otherwise the repair is
      unverifiable and the next person could delete the real "not found"
      without anything complaining. A dev backend will not 404 a bogus id
      without a session, so the harness serves it.
    */
    case "notfound":
      record(path, "stubbed");
      return json({ error: "Not found" }, 404);

    case "error":
    case "paused":
      record(path, "stubbed");
      return json({ error: "The archive could not be reached." }, 503);
  }
}

export function installStub(config: Active): void {
  active = config;
  if (!realFetch) {
    realFetch = window.fetch.bind(window);
    window.fetch = stubbed;
  }
  // The real M195 pause: a retry that cannot continue because the document
  // is not focused. Forced here rather than imitated, so what the gallery
  // shows is the state itself.
  focusManager.setFocused(config.mode === "paused" ? false : undefined);
}

export function removeStub(): void {
  if (realFetch) {
    window.fetch = realFetch;
    realFetch = null;
  }
  active = null;
  // Leaving this forced would silently pause every retry in the app for the
  // rest of the session — the very bug this harness exists to display.
  focusManager.setFocused(undefined);
}

/** Start a fresh count — called when the frame remounts. */
export function resetLedger(): void {
  ledger = [];
  onLedgerChange?.();
}

export function getLedger(): StubCall[] {
  return ledger;
}

export function watchLedger(listener: (() => void) | null): void {
  onLedgerChange = listener;
}
