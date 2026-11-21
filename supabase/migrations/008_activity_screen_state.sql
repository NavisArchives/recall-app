-- 008: The archive's own memory, and what the screen is showing.
--
-- activity_log answers "what happened here lately" in the sidebar and on
-- /admin/activity. Rows are written best-effort by the API: a failed log
-- must never fail the action it describes.
--
-- screen state lives as two columns on the single settings row (settings is
-- a typed table, not key/value), written by the display when a channel opens.
--
-- Seeds marked MOCK are demonstration rows for the accelerator; everything
-- else the dashboard shows is computed from real data.

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references people(id) on delete set null,
  action_type text not null,
  description text not null,
  target_channel_id uuid references channels(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activity_log_created_at_idx
  on activity_log (created_at desc);

alter table activity_log enable row level security;

alter table missions add column if not exists created_by uuid references people(id) on delete set null;

alter table settings add column if not exists current_channel_number integer;
alter table settings add column if not exists screen_synced_at timestamptz;

-- ── Seeds ────────────────────────────────────────────────────────────────
-- The two cards match the design's registry: a seashell for Hélène's
-- channel, a photo frame for Margaret's.

insert into nfc_cards (label, tag_code, channel_id, linked_object, linked_by)
select 'Seashell from the beach', 'A2F4',
       (select id from channels where number = 6 and archived_at is null),
       'A seashell she kept from the coast',
       (select id from people where name ilike 'andy%' limit 1)
where not exists (select 1 from nfc_cards where tag_code = 'A2F4');

insert into nfc_cards (label, tag_code, channel_id, linked_object, linked_by)
select 'Small photo frame', 'B7C1',
       (select id from channels where number = 5 and archived_at is null),
       'The frame on her bedside table',
       (select id from people where name ilike 'andy%' limit 1)
where not exists (select 1 from nfc_cards where tag_code = 'B7C1');

-- MOCK: one mission already under way. Its source key matches what the API
-- derives for an uncarded channel, so the suggestion is not offered twice.
insert into missions (title, detail, status, source, assigned_to)
select 'Link an NFC card to Channel 01',
       'So Margaret can open "Beautiful tree" by touching an object.',
       'in_progress',
       'auto:nfc:' || (select id from channels where number = 1 and archived_at is null),
       (select id from people where name ilike 'andy%' limit 1)
where not exists (select 1 from missions where title = 'Link an NFC card to Channel 01');

insert into missions (title, detail, status)
select 'Add childhood photos', 'The archive has nothing before 1971.', 'suggested'
where not exists (select 1 from missions where title = 'Add childhood photos');

insert into missions (title, detail, status)
select 'Record a message from Luc', 'Margaret returns to voices most often.', 'suggested'
where not exists (select 1 from missions where title = 'Record a message from Luc');

-- MOCK: three lines of history so the sidebar is not empty on day one.
insert into activity_log (author_id, action_type, description)
select (select id from people where name ilike 'h%l%ne%' limit 1),
       'media_added', 'Hélène added 3 photos'
where not exists (select 1 from activity_log where description = 'Hélène added 3 photos');

insert into activity_log (author_id, action_type, description)
select (select id from people where name ilike 'andy%' limit 1),
       'nfc_linked', 'Andy linked an NFC card'
where not exists (select 1 from activity_log where description = 'Andy linked an NFC card');

insert into activity_log (author_id, action_type, description)
select (select id from people where name ilike 'odette%' limit 1),
       'channel_created', 'Odette created Channel 07'
where not exists (select 1 from activity_log where description = 'Odette created Channel 07');

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'activity_log table' as check,
       case when exists (select 1 from information_schema.tables
                         where table_name = 'activity_log')
            then 'OK' else 'MISSING' end as result
union all
select 'activity rls',
       case when (select relrowsecurity from pg_class where relname = 'activity_log')
            then 'OK' else 'MISSING' end
union all
select 'missions.created_by',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'missions' and column_name = 'created_by')
            then 'OK' else 'MISSING' end
union all
select 'settings screen columns',
       case when (select count(*) from information_schema.columns
                  where table_name = 'settings'
                    and column_name in ('current_channel_number', 'screen_synced_at')) = 2
            then 'OK' else 'MISSING' end
union all
select 'cards linked to channels',
       case when (select count(*) from nfc_cards where channel_id is not null) >= 2
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'missions seeded',
       case when (select count(*) from missions where archived_at is null) >= 3
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'activity seeded',
       case when (select count(*) from activity_log) >= 3
            then 'OK' else 'CHECK MANUALLY' end;
