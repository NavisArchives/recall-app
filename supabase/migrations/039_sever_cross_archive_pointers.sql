-- 039 — Legacy rows stop pointing across families
--
-- 038 added composite foreign keys and two refused to validate: some
-- `activity_log.target_channel_id` and `nfc_cards.channel_id` values name a
-- channel outside the row's own archive. These are exactly the stitched-
-- across rows M09 exists to forbid — most plausibly relics of the
-- pre-archive era, attributed to different families by 038's backfill than
-- the channels they once pointed at.
--
-- The repair severs the pointer rather than guessing an archive: an activity
-- line simply loses its channel link (the sentence it displays is unchanged),
-- and an NFC card returns to the unassigned pool, which is a state the admin
-- UI already understands and can re-link from. Both columns are SET NULL on
-- channel deletion anyway, so nothing downstream meets a shape it has not
-- always had to handle.
--
-- Then the two constraints validate, completing 038: every composite key
-- checked against every row, old and new.

create temp table _m39 (check_name text, result text) on commit drop;

do $$
declare
  severed bigint;
begin
  update activity_log l
     set target_channel_id = null
   where l.target_channel_id is not null
     and not exists (
       select 1 from channels c
       where c.id = l.target_channel_id and c.archive_id = l.archive_id
     );
  get diagnostics severed = row_count;
  insert into _m39 values ('activity_log cross-archive links severed', severed::text);

  update nfc_cards n
     set channel_id = null
   where n.channel_id is not null
     and not exists (
       select 1 from channels c
       where c.id = n.channel_id and c.archive_id = n.archive_id
     );
  get diagnostics severed = row_count;
  insert into _m39 values ('nfc_cards cross-archive links severed', severed::text);
end $$;

alter table activity_log validate constraint activity_log_target_channel_id_fkey;
alter table nfc_cards validate constraint nfc_cards_channel_id_fkey;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select check_name as check, result from _m39
union all
select 'every 038 composite key is now validated',
       case when not exists (
         select 1 from pg_constraint
         where contype = 'f' and not convalidated
           and conname in (
             'activity_log_target_channel_id_fkey', 'nfc_cards_channel_id_fkey'
           )
       ) then 'OK' else 'STILL NOT VALIDATED' end
order by 1;
