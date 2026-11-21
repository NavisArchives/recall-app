-- 057 — Two ways to hold it (owner, 17 Sep 2026 — pricing simplified for launch)
--
-- The four-tier ladder (Archive/Control/Connect/Dock) is retired in favour of
-- two: Recall (digital — her own screen, nothing to install) and Recall Dock
-- (the physical media hub, keyboard and connected-card reader). A reader or
-- keyboard bought alone becomes a package on top of Recall later — not a
-- separate tier today. Both configurations are €25/month or €275/year (one
-- month free); the Dock adds a one-time device cost confirmed at invoice,
-- since its landed cost is not yet settled (doc 15).
--
-- This migration adds only what the new request-invite flow needs to record
-- what a family asked for, so the owner's doorstep shows it and the first
-- invoice can be built from it without re-asking.

alter table invitation_requests
  add column if not exists interested_tier text
    check (interested_tier is null or interested_tier in ('digital', 'dock')),
  add column if not exists billing_period text
    check (billing_period is null or billing_period in ('monthly', 'yearly'));

comment on column invitation_requests.interested_tier is
  'Which configuration they asked about: digital (her own screen) or dock '
  '(the physical media hub). Null for requests made before this column '
  'existed, or from a form that did not ask.';

comment on column invitation_requests.billing_period is
  'monthly or yearly (11x monthly, one month free), as they chose on the '
  'request page. Informational only — the owner still invoices by hand.';

-- The family's own choice, carried from the request onto the account so the
-- first invoice defaults to what they actually asked for.
alter table families
  add column if not exists billing_period text
    check (billing_period is null or billing_period in ('monthly', 'yearly'));

comment on column families.billing_period is
  'monthly or yearly (055/057) — which the invoice route bills by default. '
  'Set from the request page''s choice, changeable by the owner per invoice.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'families carries billing_period' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'families' and column_name = 'billing_period'
       ) then 'OK' else 'MISSING' end as result
union all
select 'invitation_requests carries interested_tier',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitation_requests' and column_name = 'interested_tier'
       ) then 'OK' else 'MISSING' end as result
union all
select 'invitation_requests carries billing_period',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitation_requests' and column_name = 'billing_period'
       ) then 'OK' else 'MISSING' end
union all
select 'interested_tier is one of two words or null',
       case when exists (
         select 1 from information_schema.check_constraints c
         join information_schema.constraint_column_usage u on u.constraint_name = c.constraint_name
         where u.table_name = 'invitation_requests' and u.column_name = 'interested_tier'
       ) then 'OK' else 'MISSING' end
union all
select 'requests recorded so far (informational)',
       (select count(*)::text from invitation_requests);
