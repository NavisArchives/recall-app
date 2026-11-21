-- Migration 002: per-photo captions and dates
--
-- The display shows a caption and date that change with each photo in an
-- album, rather than one description for the whole channel. Both are optional;
-- the channel's own description and date remain the fallback.

begin;

alter table media_files add column if not exists caption text;
alter table media_files add column if not exists taken_on date;

commit;

-- ------------------------------------------------------------
-- Verification — every `ok` must be true. No rows means it did not run.
-- ------------------------------------------------------------
select 'media_files.caption added' as check,
       exists (select 1 from information_schema.columns
               where table_name = 'media_files' and column_name = 'caption') as ok
union all
select 'media_files.taken_on added',
       exists (select 1 from information_schema.columns
               where table_name = 'media_files' and column_name = 'taken_on');
