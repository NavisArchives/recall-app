-- 041 — An installation says which build it is running
--
-- The Overview's device card has always read "Online · software 2.1". The
-- number was typed into the markup: nothing versions an installation, and
-- `deviceStream` said so honestly, returning `software_version: null` with a
-- comment calling it a declared gap. The frontend held the same admission in
-- its placeholder register under `device.software`.
--
-- This is the column that ends the admission. One nullable text field on the
-- installation itself, because the version belongs to *that machine* — a
-- household may eventually have a screen on an old build and a tablet on a
-- new one, and a single per-archive version could not say so.
--
-- Nullable, and null is meaningful: it means the machine has never told us.
-- An installation paired before this migration, or one running a build old
-- enough not to report, is genuinely unknown — and the card says nothing
-- rather than inventing a number, which is the whole point of the exercise.
--
-- Length-capped because it is a self-reported string from the edge. A version
-- is "1.4.2" or "2026.08.10-a3f9c1"; 40 characters is generous for both and
-- refuses a field being used as a smuggling channel.
--
-- No new table, so no new RLS surface: `installations` has had RLS enabled
-- with no policies since 005 — anonymous clients are denied everything and
-- only the backend's service key touches it. Archive scoping is already the
-- table's own (`archive_id`, not null since 010), and the reporter writes
-- exactly one row: the installation named by its own device cookie.

alter table installations add column if not exists software_version text;

alter table installations drop constraint if exists installations_software_version_sane;
alter table installations add constraint installations_software_version_sane check (
  software_version is null
  or (length(software_version) between 1 and 40)
);

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'software_version column exists' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'installations'
                           and column_name = 'software_version')
            then 'OK' else 'MISSING' end as result
union all
select 'nullable (null = never reported)',
       case when (select is_nullable from information_schema.columns
                  where table_name = 'installations'
                    and column_name = 'software_version') = 'YES'
            then 'OK' else 'NOT NULLABLE' end
union all
select 'length guard present',
       case when exists (select 1 from pg_constraint
                         where conname = 'installations_software_version_sane')
            then 'OK' else 'MISSING' end
union all
select 'existing installations survive as unreported',
       case when not exists (select 1 from installations where software_version is not null)
            then 'OK' else 'UNEXPECTED VALUES' end
union all
select 'rls still enabled on installations',
       case when (select relrowsecurity from pg_class where relname = 'installations')
            then 'OK' else 'RLS OFF' end
union all
select 'archive scoping intact',
       case when (select is_nullable from information_schema.columns
                  where table_name = 'installations' and column_name = 'archive_id') = 'NO'
            then 'OK' else 'ARCHIVE_ID NULLABLE' end;
