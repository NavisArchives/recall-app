-- 009: How the screen is actually used, and what the archive is missing.
--
-- Three things live here, and they are deliberately kept apart:
--
--   device_sessions / channel_visits — measurement of Margaret's own use of
--   her screen. Written by the display, never by anyone browsing the admin.
--
--   suggestions — rule-based checks on how complete the archive is. Nobody
--   writes these by hand; they are recomputed from the data itself and feed
--   Archive Health and "needs attention".
--
--   (missions, from 007, are human tasks and stay entirely separate. A
--   suggestion never becomes a mission on its own.)
--
-- Nothing here records anything about Margaret as a person: only which
-- memory was open, for how long, and how it was opened.

create table if not exists device_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  device_label text not null default 'main-screen',
  created_at timestamptz not null default now()
);

create table if not exists channel_visits (
  id uuid primary key default gen_random_uuid(),
  device_session_id uuid references device_sessions(id) on delete cascade,
  channel_id uuid references channels(id) on delete cascade,
  channel_number integer not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  media_viewed_count integer not null default 0,
  -- 'nfc' is inferred from typing speed: a card reader types the two digits
  -- far faster than a hand can. It is a reasonable guess, not a fact.
  entry_method text not null default 'keyboard'
    check (entry_method in ('keyboard', 'nfc', 'overview', 'direct'))
);

create index if not exists channel_visits_channel_idx on channel_visits (channel_id);
create index if not exists channel_visits_session_idx on channel_visits (device_session_id);
create index if not exists channel_visits_started_idx on channel_visits (started_at desc);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete cascade,
  rule_key text not null,
  message text not null,
  severity text not null default 'info' check (severity in ('info', 'warning')),
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, rule_key)
);

create index if not exists suggestions_open_idx on suggestions (resolved) where resolved = false;

-- Service-role only, like every other table in this project: the API decides
-- who may read and write, because there is no auth.uid() here to police.
alter table device_sessions enable row level security;
alter table channel_visits enable row level security;
alter table suggestions enable row level security;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'device_sessions' as check,
       case when exists (select 1 from information_schema.tables
                         where table_name = 'device_sessions')
            then 'OK' else 'MISSING' end as result
union all
select 'channel_visits',
       case when exists (select 1 from information_schema.tables
                         where table_name = 'channel_visits')
            then 'OK' else 'MISSING' end
union all
select 'suggestions',
       case when exists (select 1 from information_schema.tables
                         where table_name = 'suggestions')
            then 'OK' else 'MISSING' end
union all
select 'visit indexes',
       case when (select count(*) from pg_indexes
                  where tablename = 'channel_visits'
                    and indexname in ('channel_visits_channel_idx',
                                      'channel_visits_session_idx',
                                      'channel_visits_started_idx')) = 3
            then 'OK' else 'MISSING' end
union all
select 'suggestion uniqueness',
       case when exists (select 1 from pg_indexes
                         where tablename = 'suggestions'
                           and indexdef like '%UNIQUE%channel_id%rule_key%')
            then 'OK' else 'MISSING' end
union all
select 'rls on all three',
       case when (select bool_and(relrowsecurity) from pg_class
                  where relname in ('device_sessions', 'channel_visits', 'suggestions'))
            then 'OK' else 'MISSING' end;
