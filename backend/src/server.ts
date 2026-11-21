import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prefetchMedia } from "./services/prefetch.js";
import {
  bootDecision,
  checkSchema,
  describeFailures,
  mustRefuseOnMismatch,
} from "./services/schemaPreflight.js";

/*
  Ask the database whether it has the columns this build needs, before
  serving anything (M223).

  Twice on 20 Aug 2026 a commit shipped a column list ahead of its migration,
  and both times the product broke with a sentence pointing elsewhere — "The
  contributors could not be loaded", a 500 that reads like a data problem.
  Nobody looks for an unrun migration because the failure never says
  migration.

  WHERE IT REFUSES, AND WHY ONLY THERE. The first version of this refused
  everywhere, and within the hour it had taken the development server down
  and blocked every other seat — because the live database really is missing
  `admin_note` and `npm run dev` never set NODE_ENV, so a laptop looked like
  production. The reasoning for refusing is sound and unchanged, but it is
  reasoning about Cloud Run: there, a revision that fails to become ready
  leaves the PREVIOUS revision serving, so refusing preserves a working
  server. On a laptop there is no previous revision. Refusing preserves
  nothing — it just means no server at all, and the developer cannot reach
  the product to fix the very thing the guard is complaining about.

  The diagnosis was always the valuable half, and the message carries it. So
  outside production we say the same thing just as loudly and then serve;
  in production we still refuse.

  THE SIGNAL IS EXPLICIT, AND ITS ABSENCE MEANS PRODUCTION. `RECALL_ENV` is
  read here and set in package.json's dev script — greppable in both places,
  inferred from nothing. A missing or unreadable signal falls through to
  refusing, because the dangerous direction is a production deploy quietly
  deciding it is a laptop; the harmless direction is a laptop being told to
  set a variable.
*/
/*
  A POSTURE DEPARTURE NEVER REFUSES (067). The preflight runs on every
  container start, not only a new revision's: a replacement instance of the
  revision already serving has no previous revision to fall back to, and a
  table created without RLS from the dashboard would take the API — and her
  display with it — down at the next cold start. So posture is reported at
  error level, loudly, and the server serves; only a column or function this
  build needs and the database lacks still refuses. See bootDecision.
*/
const failures = await checkSchema();
const decision = bootDecision(failures);
if (decision !== "serve") {
  const report = describeFailures(failures);
  if (decision === "refuse") {
    console.error("\n[preflight] " + report + "\n[preflight] Refusing to start.\n");
    process.exit(1);
  }
  const posture = failures.some((f) => f.kind === "posture");
  const log = posture ? console.error : console.warn;
  log(
    "\n[preflight] " +
      report +
      (mustRefuseOnMismatch()
        ? "\n[preflight] Serving anyway: a posture departure is reported, never a reason to go dark.\n"
        : "\n[preflight] Serving anyway — RECALL_ENV=development.\n")
  );
}

createApp().listen(env.port, () => {
  console.log(`[server] Recall backend listening on http://localhost:${env.port}`);

  // Only a kiosk warms its disk, and only with its own family's media. A
  // shared API pre-downloading every customer's photographs would make each
  // replica a copy of the whole product — so it is off unless a machine says
  // it is a kiosk and says whose.
  if (env.role !== "kiosk") return;

  if (!env.kioskArchiveId) {
    console.warn(
      "[prefetch] RECALL_ROLE=kiosk but RECALL_KIOSK_ARCHIVE_ID is unset — nothing to warm."
    );
    return;
  }

  // After listen, so a slow or offline start never delays boot.
  void prefetchMedia(env.kioskArchiveId);
});
