-- 034 — A subscription column, and deliberately nothing in it (M68)
--
-- The owner wants to see how many families are subscribed. Nothing records a
-- subscription, and what a subscription *is* — tiers, price, what separates
-- "active" from "trial" — is undecided: the paywall is parked until the
-- incubator conversation.
--
-- So this is the seam and only the seam. A nullable column, null meaning "no
-- plan", so the dashboard can count truthfully (zero, today) and needs no
-- redesign when plans land. No tiers are named here, no default is assumed,
-- and no code interprets the value beyond "set or not set". Inventing a plan
-- model in a migration would be deciding a business question by writing SQL,
-- which is the wrong room for it.

alter table families
  add column if not exists subscription text;

comment on column families.subscription is
  'The family''s plan, once plans exist. Null means no subscription. '
  'Deliberately uninterpreted: tiers, price and what "active" means are an '
  'owner decision (parked until the incubator talk), so nothing reads this '
  'beyond counting whether it is set.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'families carries a subscription seam' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'families' and column_name = 'subscription'
       ) then 'OK' else 'MISSING' end as result
union all
select 'it is nullable, so "no plan" is a real state rather than a guess',
       case when (
         select is_nullable from information_schema.columns
         where table_name = 'families' and column_name = 'subscription'
       ) = 'YES' then 'OK' else 'NOT NULLABLE' end
union all
select 'nobody is subscribed yet, which is the honest number',
       (select count(*)::text from families where subscription is not null);
