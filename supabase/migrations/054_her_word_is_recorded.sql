-- 054 — Her word is recorded (launch sweep, 16 Sep 2026)
--
-- Being the subject of a Recall archive reveals a health condition by
-- inference (CJEU C-184/20), so showing her life on her screen rests on
-- explicit consent — hers, or that of whoever may lawfully decide for her
-- (a bewindvoerder over de persoon, or a zorgvolmacht that covers personal
-- matters). Until now sign-up asked for none of this: the product processed
-- special-category data with no documented basis.
--
-- This table is the record. One row per declaration; a new declaration is a
-- new row, so the history stays (who said what, in which wording, when).
-- `withdrawn_at` closes a declaration without deleting it — a withdrawal is
-- itself a fact the archive must be able to show.
--
-- `basis`:
--   self         — she consents herself
--   guardian     — a court-appointed guardian over her person (bewind)
--   care_mandate — a care mandate (zorgvolmacht) covering this
--
-- `text_version` names the wording that was agreed to (frontend/src/lib/
-- consent.ts), so a later rewording never claims a signature it did not get.

create table if not exists archive_consents (
  id                  uuid primary key default gen_random_uuid(),
  archive_id          uuid not null references archives(id) on delete cascade,
  basis               text not null check (basis in ('self', 'guardian', 'care_mandate')),
  signer_name         text not null,
  signer_relationship text,
  subject_name        text not null,
  declared_by         uuid,
  text_version        text not null,
  lang                text not null check (lang in ('en', 'nl')),
  declared_at         timestamptz not null default now(),
  withdrawn_at        timestamptz,
  withdrawn_reason    text,
  -- The declaring person belongs to the same archive (038's rule for every
  -- person-pointing column); losing the person keeps the declaration.
  constraint archive_consents_declared_by_fkey
    foreign key (declared_by, archive_id) references people (id, archive_id)
    on delete set null (declared_by)
);

create index if not exists archive_consents_archive_declared_idx
  on archive_consents (archive_id, declared_at desc);

comment on table archive_consents is
  'Explicit consent (GDPR Art. 9(2)(a)) for showing the subject''s life on her '
  'screen: by herself, or by whoever may lawfully decide for her. One row per '
  'declaration; withdrawn_at closes one without erasing it. Read by the archive''s '
  'admins and never by the display.';

alter table archive_consents enable row level security;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'archive_consents exists' as check,
       case when to_regclass('archive_consents') is not null then 'OK' else 'MISSING' end as result
union all
select 'RLS is enabled with no policies',
       case when (select relrowsecurity from pg_class where oid = to_regclass('archive_consents'))
              and not exists (select 1 from pg_policies where tablename = 'archive_consents')
            then 'OK' else 'OPEN' end
union all
select 'basis is one of three words',
       case when exists (
         select 1 from information_schema.check_constraints c
         join information_schema.constraint_column_usage u on u.constraint_name = c.constraint_name
         where u.table_name = 'archive_consents' and u.column_name = 'basis'
       ) then 'OK' else 'MISSING' end
union all
select 'declared_by points inside the same archive',
       case when exists (
         select 1 from pg_constraint where conname = 'archive_consents_declared_by_fkey'
       ) then 'OK' else 'MISSING' end
union all
select 'declarations recorded so far (expected 0 on first run)',
       (select count(*)::text from archive_consents);
