-- 014: A mission knows where it happens and when it is done.
--
-- Until now a mission was a sentence. Now it points at a channel and
-- carries a countable task, so "done" is objective rather than a feeling:
-- describing photos is done when no photo is left wordless, linking a card
-- is done when the channel has one.

alter table missions add column if not exists channel_id uuid references channels(id) on delete set null;
alter table missions add column if not exists task_kind text
  check (task_kind is null or task_kind in ('describe_photos', 'link_nfc', 'add_photos', 'record', 'custom'));
alter table missions add column if not exists task_count integer;

-- The seeded missions learn their targets.
update missions
set channel_id = (select id from channels where number = 1 and archived_at is null limit 1),
    task_kind = 'link_nfc',
    task_count = 1
where title = 'Link an NFC card to Channel 01' and channel_id is null;

update missions
set task_kind = 'add_photos'
where title = 'Add childhood photos' and task_kind is null;

update missions
set task_kind = 'record', task_count = 1
where title = 'Record a message from Luc' and task_kind is null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'missions.channel_id' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'missions' and column_name = 'channel_id')
            then 'OK' else 'MISSING' end as result
union all
select 'missions.task_kind',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'missions' and column_name = 'task_kind')
            then 'OK' else 'MISSING' end
union all
select 'missions.task_count',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'missions' and column_name = 'task_count')
            then 'OK' else 'MISSING' end
union all
select 'nfc seed targeted',
       case when exists (select 1 from missions where task_kind = 'link_nfc' and channel_id is not null)
            then 'OK' else 'CHECK MANUALLY' end;
