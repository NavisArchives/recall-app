#!/usr/bin/env bash
#
# The release gate, as one command.
#
# There is no hosted CI (origin is a private backup, with no CI by the owner's
# decision; only Dependabot watches it), so this is the gate: run it before
# any release, and a release is only a release if every
# section passes. Each check is something a scanner or an audit has already
# caught this project missing once — the list is scar tissue, not ceremony.
#
#   ./scripts/verify.sh
#
# The staging integration suite is not here because it needs credentials and
# a scratch project; run it deliberately when the database contract changed:
#
#   STAGING_SUPABASE_URL=https://<ref>.supabase.co \
#   STAGING_SUPABASE_SERVICE_ROLE_KEY=<the scratch project's service key> \
#   STAGING_PROJECT_REF=<ref> \
#   npm --prefix backend run test:staging
#
# All three are required and there is no fallback to the application's own
# SUPABASE_URL — a destructive suite must never be able to reach production by
# inheriting whatever happened to be in .env. STAGING_PROJECT_REF must repeat
# the ref inside the URL: naming the target twice is how the operator says
# "yes, that exact project is the scratch one". Until it runs at least once,
# every claim about migration bodies, constraints and RLS rests on mocks.

set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "backend: typecheck"
npm --prefix backend run typecheck

step "backend: tests"
# Serial, for reproducibility rather than as a fix: two different test files
# have each failed once in a parallel run and passed on retry and in
# isolation. The cause is not established — do not read this flag as one — but
# a release gate is the wrong place to carry an unexplained intermittent, and
# a few seconds is a cheap price for a run that means the same thing twice.
npm --prefix backend test -- --no-file-parallelism

# Two bars, on purpose. What ships (--omit=dev) fails on a moderate: the
# ip-address moderate sat in the production tree for weeks because this gate
# only looked for high (29 Sep 2026 review, deps-5). The dev tree — compilers,
# test runners — fails on high, as before.
step "backend: dependency audit (shipped: moderate+, all: high+)"
npm --prefix backend audit --omit=dev --audit-level=moderate
npm --prefix backend audit --audit-level=high

step "frontend: typecheck"
npm --prefix frontend run typecheck

step "frontend: lint"
npm --prefix frontend run lint

step "frontend: tests"
npm --prefix frontend test

step "frontend: build"
# vite.config.ts refuses a production build without VITE_BACKEND_URL, and
# refuses a localhost one — which is what a laptop's frontend/.env holds. The
# gate builds what ships.
VITE_BACKEND_URL=https://REPLACE_ME_API_ORIGIN npm --prefix frontend run build

step "frontend: dependency audit (shipped: moderate+, all: high+)"
npm --prefix frontend audit --omit=dev --audit-level=moderate
npm --prefix frontend audit --audit-level=high

step "secrets: nothing sensitive staged"
# .env files are gitignored; this catches the day one is forced through, and
# obvious key material in anything about to ship.
if git ls-files | grep -E '(^|/)\.env(\..*)?$' | grep -v '\.example$'; then
  echo "ERROR: an .env file is tracked by git." >&2
  exit 1
fi
# sb_publishable_ and sbp_ too: a publishable key once reached the pushed
# history inside an .env.example (d4681f7), and a management token is worse
# than the service-role key — it controls the whole Supabase account.
if git grep -nE 'sb_secret_|sb_publishable_|sbp_[A-Za-z0-9]{20}|service_role_key|-----BEGIN (RSA |EC )?PRIVATE KEY-----' -- \
  ':!*.md' ':!scripts/verify.sh' ':!backend/src/__tests__/*' ; then
  echo "ERROR: something above looks like a committed secret." >&2
  exit 1
fi
echo "clean"

printf '\n\033[1mAll gates passed.\033[0m\n'
