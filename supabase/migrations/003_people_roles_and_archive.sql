-- Migration 003: people, per-person access codes, devices, soft delete
--
-- Replaces the single shared admin password with per-person access codes, each
-- carrying a role and revocable on its own. `authors` becomes `people`: the
-- same person can be someone Margaret remembers *and* someone who contributes.
--
-- Margaret herself is never in this system. The display authenticates as a
-- paired device, so she has no code and no role.

begin;

-- ------------------------------------------------------------
-- 1. authors -> people
-- ------------------------------------------------------------
alter table if exists authors rename to people;

alter table people add column if not exists updated_at timestamptz not null default now();
alter table people add column if not exists archived_at timestamptz;

-- ------------------------------------------------------------
-- 2. Access codes
-- ------------------------------------------------------------
-- A code is presented as "<lookup>-<secret>". Only `lookup` is stored in the
-- clear so a login can find the row in one indexed read; the secret is stored
-- as an argon2/bcrypt hash and compared in constant time by the backend.
create table if not exists access_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  lookup text not null unique,
  secret_hash text not null,
  role text not null check (role in ('admin', 'contributor', 'viewer')),
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references people (id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_access_codes_person on access_codes (person_id);
create index if not exists idx_access_codes_active on access_codes (lookup) where revoked_at is null;

-- ------------------------------------------------------------
-- 3. Paired display devices
-- ------------------------------------------------------------
create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null,
  created_at timestamptz not null default now(),
  paired_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- ------------------------------------------------------------
-- 4. Attribution + soft delete on content
-- ------------------------------------------------------------
alter table channels add column if not exists created_by uuid references people (id) on delete set null;
alter table channels add column if not exists updated_at timestamptz not null default now();
alter table channels add column if not exists archived_at timestamptz;

alter table media_files add column if not exists created_by uuid references people (id) on delete set null;
alter table media_files add column if not exists archived_at timestamptz;

alter table steps add column if not exists archived_at timestamptz;
alter table step_items add column if not exists archived_at timestamptz;

-- Archived rows are excluded from every read, so index the live ones.
create index if not exists idx_channels_live on channels (number) where archived_at is null;
create index if not exists idx_media_files_live on media_files (channel_id) where archived_at is null;

-- A channel number may be reused once the old channel is archived, so the
-- uniqueness constraint must only apply to live rows.
alter table channels drop constraint if exists channels_number_key;
drop index if exists channels_number_unique_live;
create unique index channels_number_unique_live on channels (number) where archived_at is null;

-- ------------------------------------------------------------
-- 5. RLS on the new tables (backend-only, same as the rest)
-- ------------------------------------------------------------
alter table access_codes enable row level security;
alter table devices enable row level security;

commit;

-- ------------------------------------------------------------
-- Verification — every `ok` must be true. No rows means it did not run.
-- ------------------------------------------------------------
select 'people table exists' as check,
       exists (select 1 from information_schema.tables
               where table_name = 'people') as ok
union all
select 'authors table gone',
       not exists (select 1 from information_schema.tables where table_name = 'authors')
union all
select 'access_codes created',
       exists (select 1 from information_schema.tables where table_name = 'access_codes')
union all
select 'devices created',
       exists (select 1 from information_schema.tables where table_name = 'devices')
union all
select 'channels.created_by added',
       exists (select 1 from information_schema.columns
               where table_name = 'channels' and column_name = 'created_by')
union all
select 'channels.archived_at added',
       exists (select 1 from information_schema.columns
               where table_name = 'channels' and column_name = 'archived_at')
union all
select 'channel number unique only while live',
       exists (select 1 from pg_indexes
               where indexname = 'channels_number_unique_live');
