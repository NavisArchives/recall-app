-- 011: The subject belongs to an archive, not to the installation.
--
-- `settings` was written when there was one household: its primary key is a
-- boolean, pinned to true, so the table can physically hold one row. That was
-- an honest shape for a single archive and is a hard wall in front of the
-- second one — no second family can have a subject at all.
--
-- It becomes one row per archive, keyed properly, with the archive it belongs
-- to required and unique. The name stays `settings` for now so the change is
-- one thing rather than two; what it holds is the person the archive is
-- about.

alter table settings drop constraint if exists settings_pkey;

-- A real key. The boolean goes; nothing referenced it.
alter table settings add column if not exists uid uuid not null default gen_random_uuid();
alter table settings drop column if exists id;
alter table settings rename column uid to id;
alter table settings add primary key (id);

-- Every subject belongs to exactly one archive, and each archive has one.
alter table settings alter column archive_id set not null;
alter table settings add constraint settings_archive_unique unique (archive_id);

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'id is uuid' as check,
       case when (select data_type from information_schema.columns
                  where table_name='settings' and column_name='id') = 'uuid'
            then 'OK' else 'STILL BOOLEAN' end as result
union all
select 'id is the primary key',
       case when exists (
         select 1 from information_schema.table_constraints tc
         join information_schema.key_column_usage k on k.constraint_name = tc.constraint_name
         where tc.table_name='settings' and tc.constraint_type='PRIMARY KEY' and k.column_name='id')
       then 'OK' else 'MISSING' end
union all
select 'archive_id required',
       case when (select is_nullable from information_schema.columns
                  where table_name='settings' and column_name='archive_id') = 'NO'
            then 'OK' else 'STILL NULLABLE' end
union all
select 'one subject per archive',
       case when exists (select 1 from pg_constraint where conname='settings_archive_unique')
            then 'OK' else 'MISSING' end
union all
select 'Margaret survived',
       case when (select count(*) from settings) = 1 then 'OK' else 'CHECK MANUALLY' end;
