-- 030 — One family row is the platform's, not a family's (M55)
--
-- Two unrelated things are called "owner" in this product and they must not
-- be fused:
--
--   * the **family owner** — the admin whose family owns one archive. That is
--     `archives.owner_account_id`, and it is what families see.
--   * the **platform owner** — whoever runs Recall itself, across every
--     family. That is this flag.
--
-- They are different powers over different scopes. A family owner manages one
-- archive's memories; the platform owner sees information about every family
-- and, by rule, none of their content. Anything named plainly "owner" in this
-- codebase from here on means the family one; the platform sense always says
-- `platform_owner` in full.
--
-- **No UI ever sets this.** There is no sign-up for the platform owner and no
-- screen that grants it — the flag is flipped by SQL against a known row, by
-- somebody already holding the database. A form that could grant it would be
-- a form worth attacking.

alter table families
  add column if not exists platform_owner boolean not null default false;

comment on column families.platform_owner is
  'Runs the Recall platform itself — sees information about every family and '
  'none of their content. Not the family owner (archives.owner_account_id). '
  'Set by SQL only; no route or UI grants it.';

-- The flag is a global power, so more than one holder should be a decision
-- somebody makes on purpose rather than a row that drifted.
create unique index if not exists families_one_platform_owner
  on families ((platform_owner))
  where platform_owner;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'families carries platform_owner' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'families' and column_name = 'platform_owner'
       ) then 'OK' else 'MISSING' end as result
union all
select 'it defaults to false, so nobody gains it by existing',
       case when (
         select column_default from information_schema.columns
         where table_name = 'families' and column_name = 'platform_owner'
       ) = 'false' then 'OK' else 'WRONG DEFAULT' end
union all
select 'at most one platform owner',
       case when exists (
         select 1 from pg_indexes where indexname = 'families_one_platform_owner'
       ) then 'OK' else 'MISSING' end
union all
select 'nobody holds it yet unless deliberately granted',
       (select count(*)::text from families where platform_owner);
