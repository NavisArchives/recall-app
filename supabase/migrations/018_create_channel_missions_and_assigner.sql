-- 018: A mission can ask for a whole new channel, and a task remembers who gave it.
--
-- "Create a channel of your holiday" is a real task an admin sends to the
-- youngest sister — it needs its own kind, because its destination is the
-- create page and its finish line is the channel existing. And when one
-- person assigns work to another, the card should say so: assigned_by is
-- the person who did the assigning, kept separate from who does the work.

alter table missions drop constraint if exists missions_task_kind_check;
alter table missions add constraint missions_task_kind_check
  check (task_kind is null or task_kind in
    ('describe_photos', 'link_nfc', 'add_photos', 'record', 'custom', 'create_channel'));

alter table missions add column if not exists assigned_by uuid references people(id) on delete set null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'task_kind allows create_channel' as check,
       case when exists (
         select 1 from information_schema.check_constraints
         where constraint_name = 'missions_task_kind_check'
           and check_clause like '%create_channel%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'assigned_by column',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'missions' and column_name = 'assigned_by'
       ) then 'OK' else 'MISSING' end
union all
select 'existing rows still valid',
       case when not exists (
         select 1 from missions where task_kind is not null and task_kind not in
           ('describe_photos','link_nfc','add_photos','record','custom','create_channel')
       ) then 'OK' else 'INVALID' end;
