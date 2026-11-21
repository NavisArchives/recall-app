# Security

Recall keeps the private memories of families caring for someone with
dementia, so its design starts from what must never happen: one family seeing
another's archive, a stranger reading anything at all, or contact details
reaching the screen in a living room.

## The model

- **The API is the only trust boundary.** The browser holds no database
  credential and never calls the database. Only the API holds the Supabase
  service key.
- **Deny by default in the database.** Every table has row-level security
  enabled with no permissive policy, so the anonymous and authenticated
  database roles can read and write nothing. Both storage buckets are private;
  media is streamed through API routes after an authorisation check.
- **Every family-scoped query names its archive.** A route that cannot tell
  which family it is serving refuses; it never falls back to "all of them".
  The database also enforces tenancy with composite keys (migration 038).
- **Sessions are claims, the database is the truth.** Device and profile
  sessions are signed tokens in httpOnly, SameSite=Strict cookies; every
  protected request re-reads the person and the screen, so a removed member
  or a retired screen loses access on the next request.
- **Writes need an authenticated session.** Anonymous writes return `401`, and
  the tests cover it.
- **Secrets are hashed, not stored.** Passwords and PINs use argon2id (PINs
  keyed with a server-side pepper); invitation and recovery codes are stored
  as keyed hashes.
- **Guessing is bounded in the database.** A family password locks after ten
  failures, for longer each time; PIN locks escalate the same way. Every typed
  address is matched exactly, never as a LIKE pattern.
- **The platform owner** signs in with a second factor (TOTP), steps up again
  before an export or a print, and leaves an audit row for each.
- **Mail is throttled in the database**, per recipient and per day, so the
  public forms cannot be used to mail anyone repeatedly.
- **Uploads are verified by their magic bytes**, capped in size and count,
  and stored under server-generated names.
- **Contact details** (email, phone) reach an authenticated admin only, never
  the display; routes use explicit column lists.
- **Rate limits** on sign-in, recovery and public forms; `helmet` headers on
  the API; on the static site a Content-Security-Policy that allows scripts
  from its own origin only, plus HSTS, frame and content-type protection.
- **Default grants are revoked** from the anonymous and authenticated
  database roles, and the API reports its database posture (a table without
  RLS, a policy, a grant) every time it starts.

## How it is checked

- 788 backend tests run with no network or database. A recording Supabase
  client fails any family-table query that lacks an archive filter, and route
  tests cover anonymous writes, cross-family reads and contact-detail leaks.
- `scripts/verify.sh` is the release gate: typecheck, tests, lint, build,
  `npm audit --audit-level=high`, and a check that no `.env` file or key
  material is committed.
- A staging suite (50 tests) runs against a real Postgres: the database
  functions themselves, and the real routes driven with wildcard addresses
  that must never match another family.
- Each SQL migration ends with a self-verifying checklist.

## This snapshot

This is a review copy of the code as of 21 November 2026. It is not
connected to any live system: every project id, URL, key and address in it is
a placeholder or an `example.com` address. Please report a security concern
through GitHub's private vulnerability reporting on this repository rather
than in a public issue.
