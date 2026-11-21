-- 010: Many families, one Recall.
--
-- Until now every table held exactly one family's archive, so a second
-- signup would have written straight over Margaret's memories. This adds the
-- boundary that makes them separate.
--
-- The shape is the one Instagram uses, not a set of tables per family: one
-- `archives` row per household, and an `archive_id` column on every row that
-- belongs to one. A photograph therefore belongs to exactly one archive by
-- construction, the database refuses anything else, and a query that forgets
-- to filter returns another family's data loudly in testing rather than
-- quietly in production. Tables-per-family would mean creating tables at
-- signup, no way to ask a question across families, and a schema change that
-- has to run ten thousand times.
--
-- Two identities are kept apart, deliberately:
--
--   `accounts` is someone who signs in over the internet — an email address,
--   verified, belonging to a human being who may help with more than one
--   archive some day.
--
--   `people` stays what it already is: a profile inside one archive, with a
--   PIN for switching on the household screen. Hélène the account and
--   Hélène the daughter on the shelf are linked, not merged.
--
-- This migration is deliberately additive: new tables, new nullable columns,
-- and a backfill. Nothing existing is dropped or made mandatory yet, so the
-- application keeps running untouched while the code catches up.

-- ── Identity ─────────────────────────────────────────────────────────────

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_verified_at timestamptz,
  display_name text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Addresses differing only by case are the same person.
create unique index if not exists accounts_email_unique on accounts (lower(email));

create table if not exists archives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_account_id uuid references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

/*
 * Who may act inside an archive, and as what.
 *
 * `person_id` ties the account to its profile on that archive's shelf, which
 * is what lets an invited daughter arrive already labelled "Daughter" and
 * keeps her PIN, her photograph and her attribution where they already are.
 */
create table if not exists archive_memberships (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references archives(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  person_id uuid references people(id) on delete set null,
  role text not null default 'co_author' check (role in ('admin', 'co_author', 'user')),
  status text not null default 'active' check (status in ('active', 'pending', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (archive_id, account_id)
);

create index if not exists archive_memberships_account_idx on archive_memberships (account_id);

/*
 * An invitation is a promise of membership that has not been claimed yet.
 * Only the hash of the login code is kept — the code itself exists in one
 * email and nowhere else, exactly like the PINs.
 */
create table if not exists invitations (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references archives(id) on delete cascade,
  email text not null,
  name text,
  relationship text,
  role text not null default 'co_author' check (role in ('admin', 'co_author')),
  code_hash text not null,
  expires_at timestamptz not null,
  invited_by uuid references people(id) on delete set null,
  accepted_at timestamptz,
  accepted_account_id uuid references accounts(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- One live invitation per address per archive; spent ones may pile up.
create unique index if not exists invitations_pending_unique
  on invitations (archive_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table accounts enable row level security;
alter table archives enable row level security;
alter table archive_memberships enable row level security;
alter table invitations enable row level security;

-- ── The boundary column ──────────────────────────────────────────────────
-- Nullable for now; made mandatory once every query passes an archive.

alter table channels add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table people add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table settings add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table steps add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table step_items add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table media_files add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table channel_access add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table nfc_cards add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table missions add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table suggestions add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table activity_log add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table device_sessions add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table channel_visits add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table installations add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table access_codes add column if not exists archive_id uuid references archives(id) on delete cascade;

-- ── Margaret's archive becomes the first one ────────────────────────────

insert into archives (name)
select coalesce(
         (select coalesce(full_name, display_name) from settings limit 1),
         'Margaret Fournier'
       ) || '''s archive'
where not exists (select 1 from archives);

-- The person who has been administering it becomes its owner account, using
-- the address already on their profile.
insert into accounts (email, display_name, email_verified_at)
select p.email, p.name, now()
from people p
where p.role = 'admin' and p.email is not null and p.archived_at is null
  and not exists (select 1 from accounts a where lower(a.email) = lower(p.email))
limit 1;

update archives
set owner_account_id = (select id from accounts limit 1)
where owner_account_id is null;

insert into archive_memberships (archive_id, account_id, person_id, role, status)
select (select id from archives limit 1),
       (select id from accounts limit 1),
       p.id, 'admin', 'active'
from people p
where p.role = 'admin' and p.email is not null and p.archived_at is null
  and (select count(*) from accounts) > 0
  and not exists (select 1 from archive_memberships)
limit 1;

do $$
declare a uuid;
begin
  select id into a from archives order by created_at limit 1;

  update channels        set archive_id = a where archive_id is null;
  update people          set archive_id = a where archive_id is null;
  update settings        set archive_id = a where archive_id is null;
  update steps           set archive_id = a where archive_id is null;
  update step_items      set archive_id = a where archive_id is null;
  update media_files     set archive_id = a where archive_id is null;
  update channel_access  set archive_id = a where archive_id is null;
  update nfc_cards       set archive_id = a where archive_id is null;
  update missions        set archive_id = a where archive_id is null;
  update suggestions     set archive_id = a where archive_id is null;
  update activity_log    set archive_id = a where archive_id is null;
  update device_sessions set archive_id = a where archive_id is null;
  update channel_visits  set archive_id = a where archive_id is null;
  update installations   set archive_id = a where archive_id is null;
  update access_codes    set archive_id = a where archive_id is null;
end $$;

-- ── Uniqueness becomes per-archive ───────────────────────────────────────
-- Channel 01 belongs to a family, not to the product: two households must
-- both be able to have one.

drop index if exists channels_number_unique_live;
create unique index if not exists channels_number_unique_per_archive
  on channels (archive_id, number) where archived_at is null;

create index if not exists channels_archive_idx on channels (archive_id);
create index if not exists people_archive_idx on people (archive_id);
create index if not exists media_files_archive_idx on media_files (archive_id);
create index if not exists activity_log_archive_idx on activity_log (archive_id, created_at desc);

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'accounts table' as check,
       case when exists (select 1 from information_schema.tables where table_name='accounts')
            then 'OK' else 'MISSING' end as result
union all
select 'archives table',
       case when exists (select 1 from information_schema.tables where table_name='archives')
            then 'OK' else 'MISSING' end
union all
select 'memberships table',
       case when exists (select 1 from information_schema.tables where table_name='archive_memberships')
            then 'OK' else 'MISSING' end
union all
select 'invitations table',
       case when exists (select 1 from information_schema.tables where table_name='invitations')
            then 'OK' else 'MISSING' end
union all
select 'archive_id on all 15 tables',
       case when (select count(*) from information_schema.columns
                  where column_name='archive_id' and table_schema='public'
                    and table_name in ('channels','people','settings','steps','step_items',
                      'media_files','channel_access','nfc_cards','missions','suggestions',
                      'activity_log','device_sessions','channel_visits','installations',
                      'access_codes')) = 15
            then 'OK' else 'INCOMPLETE' end
union all
select 'exactly one archive',
       case when (select count(*) from archives) = 1 then 'OK' else 'CHECK MANUALLY' end
union all
select 'owner account linked',
       case when exists (select 1 from archives where owner_account_id is not null)
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'admin membership created',
       case when exists (select 1 from archive_memberships where role='admin' and status='active')
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'no orphan channels',
       case when (select count(*) from channels where archive_id is null) = 0
            then 'OK' else 'ORPHANS REMAIN' end
union all
select 'no orphan people',
       case when (select count(*) from people where archive_id is null) = 0
            then 'OK' else 'ORPHANS REMAIN' end
union all
select 'no orphan media',
       case when (select count(*) from media_files where archive_id is null) = 0
            then 'OK' else 'ORPHANS REMAIN' end
union all
select 'channel numbers unique per archive',
       case when exists (select 1 from pg_indexes
                         where indexname='channels_number_unique_per_archive')
            then 'OK' else 'MISSING' end;
