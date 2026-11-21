-- 056 — Her screen never lapses (stability sweep, 17 Sep 2026)
--
-- The device cookie that makes a screen "her screen" was signed for 30 days
-- and never renewed: every kiosk that paired lost its display on day 31,
-- with no recovery but a manual re-pair (found independently by five
-- stability-sweep finders). The owner's decision, verbatim: a 90-day
-- standard, the admin renews remotely before it ever lapses — it never goes
-- straight to expired — with a 14-day advance notice, visible to the admin
-- only, by email and in the workspace.
--
-- This migration adds only what makes that true. Enforcement stays exactly
-- where CLAUDE.md already puts it: the row decides, every request
-- (middleware/auth.ts's deviceGuard). What changes here is that the row now
-- carries a renewal date instead of the JWT alone owning the lifetime — and
-- the code raises the JWT's own signed lifetime well past this window, so a
-- family that never opens the workspace still keeps her screen playing; the
-- reminder is a courtesy on top, never the mechanism.
--
-- `session_expires_at` is set only on the one trusted installation per
-- archive (027's partial unique index already enforces "at most one"); a
-- non-trusted row's value is meaningless and never read.
-- `renewal_notified_at` is cleared on every renewal, so the next approach to
-- the 14-day mark sends a fresh notice rather than staying silent forever
-- after the first one.

alter table installations
  add column if not exists session_expires_at timestamptz,
  add column if not exists renewal_notified_at timestamptz;

comment on column installations.session_expires_at is
  'When the trusted screen''s session is due for renewal (056). 90 days from '
  'pairing or from the last renewal. Never enforced against her screen — the '
  'JWT itself is signed well past this date — it drives the admin-only '
  'workspace banner and the email nudge, both from 14 days out.';

comment on column installations.renewal_notified_at is
  'When the 14-day-out email nudge last went out for the CURRENT '
  'session_expires_at. Cleared on renewal so the next cycle notifies again.';

-- Backfill: every live trusted screen gets a real date rather than null, so
-- the notice logic has something to compare against on its very next read.
update installations
set session_expires_at = coalesce(trusted_at, now()) + interval '90 days'
where is_trusted = true
  and revoked_at is null
  and session_expires_at is null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'installations carries session_expires_at' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'installations' and column_name = 'session_expires_at'
       ) then 'OK' else 'MISSING' end as result
union all
select 'installations carries renewal_notified_at',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'installations' and column_name = 'renewal_notified_at'
       ) then 'OK' else 'MISSING' end
union all
select 'every live trusted screen has a renewal date',
       case when not exists (
         select 1 from installations
         where is_trusted = true and revoked_at is null and session_expires_at is null
       ) then 'OK' else 'GAP' end
union all
select 'trusted screens with a renewal date (informational)',
       (select count(*)::text from installations where is_trusted = true and revoked_at is null);
