-- Migration 005: two-level auth, PINs, and channel privacy
--
-- Level 1 is the installation: "is this a trusted machine?" It grants a long
-- device session so a family member can walk up to Margaret's PC and switch
-- profiles without signing the whole app out.
--
-- Level 2 is the profile: "who is at the keyboard right now?" A PIN verified
-- against pin_hash. Margaret has no PIN — the app exists because she cannot
-- reliably recall things, so a keypad between her and her own photographs
-- would defeat its purpose. Physical access to her home is that boundary.
--
-- Roles are per-person for now. Membership is deliberately modelled so that a
-- future archive_memberships table can be added additively rather than as a
-- rewrite, once there is more than one archive.

begin;

-- ------------------------------------------------------------
-- 1. Roles: viewer/contributor -> user/co_author
-- ------------------------------------------------------------
alter table people drop constraint if exists people_role_check;

update people set role = 'user' where role = 'viewer';
update people set role = 'co_author' where role = 'contributor';

alter table people add constraint people_role_check
  check (role in ('user', 'admin', 'co_author'));

alter table people alter column role set default 'co_author';

-- ------------------------------------------------------------
-- 2. Profile PINs
-- ------------------------------------------------------------
-- argon2 hash of a 6-digit PIN. Null means the profile opens without one,
-- which is the case for the person the archive is about.
alter table people add column if not exists pin_hash text;
alter table people add column if not exists pin_set_at timestamptz;
alter table people add column if not exists failed_pin_attempts integer not null default 0;
alter table people add column if not exists locked_until timestamptz;

-- ------------------------------------------------------------
-- 3. The installation (level 1)
-- ------------------------------------------------------------
create table if not exists installations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Recall',
  username text not null unique,
  secret_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table installations enable row level security;

-- ------------------------------------------------------------
-- 4. Channel privacy
-- ------------------------------------------------------------
-- 1 private   : the subject and admins only
-- 2 selected  : plus the co-authors named in channel_access
-- 3 everyone  : any signed-in profile
alter table channels add column if not exists privacy_level integer not null default 3
  check (privacy_level in (1, 2, 3));

create table if not exists channel_access (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id) on delete cascade,
  person_id uuid not null references people (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references people (id) on delete set null,
  unique (channel_id, person_id)
);

create index if not exists idx_channel_access_channel on channel_access (channel_id);
create index if not exists idx_channel_access_person on channel_access (person_id);

-- No public-read policy: who may see which memories is itself private.
alter table channel_access enable row level security;

-- ------------------------------------------------------------
-- 5. Drop the unused device-pairing table from 003
-- ------------------------------------------------------------
-- Superseded by installations: pairing was replaced by a login page.
drop table if exists devices;

commit;

-- ------------------------------------------------------------
-- Verification — every `ok` must be true. No rows means it did not run.
-- ------------------------------------------------------------
select 'roles renamed to user/admin/co_author' as check,
       not exists (select 1 from people where role in ('viewer', 'contributor')) as ok
union all
select 'an admin still exists',
       exists (select 1 from people where role = 'admin')
union all
select 'people.pin_hash added',
       exists (select 1 from information_schema.columns
               where table_name = 'people' and column_name = 'pin_hash')
union all
select 'installations table created',
       exists (select 1 from information_schema.tables where table_name = 'installations')
union all
select 'channels.privacy_level added',
       exists (select 1 from information_schema.columns
               where table_name = 'channels' and column_name = 'privacy_level')
union all
select 'channel_access created',
       exists (select 1 from information_schema.tables where table_name = 'channel_access')
union all
select 'unused devices table dropped',
       not exists (select 1 from information_schema.tables where table_name = 'devices');
