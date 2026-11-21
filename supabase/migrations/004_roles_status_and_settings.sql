-- Migration 004: role on the person, account status, and Margaret's profile
--
-- Role moves from access_codes to people. A person has one level; their codes
-- are just credentials, so an admin changes someone's role once rather than
-- reissuing every code they hold.
--
-- No RLS policies are added here. The browser never talks to Supabase
-- directly, so auth.uid() is always null and any `TO authenticated` policy
-- would match nothing. RLS stays enabled with no policies, which denies the
-- browser everything; the backend is the only path in and enforces roles.

begin;

-- ------------------------------------------------------------
-- 1. Role and status on the person
-- ------------------------------------------------------------
alter table people add column if not exists role text not null default 'contributor'
  check (role in ('admin', 'contributor', 'viewer'));

-- pending: invited but has never signed in. active: has used a code.
alter table people add column if not exists status text not null default 'pending'
  check (status in ('pending', 'active', 'deactivated'));

alter table people add column if not exists last_seen_at timestamptz;

-- Carry across the role each person's existing code was issued with.
update people p
set role = c.role
from (
  select distinct on (person_id) person_id, role
  from access_codes
  where revoked_at is null
  order by person_id, created_at desc
) c
where c.person_id = p.id;

-- Anyone who has already used a code is active.
update people p
set status = 'active'
where exists (
  select 1 from access_codes c
  where c.person_id = p.id and c.last_used_at is not null
);

-- access_codes.role is now redundant; the person's role is authoritative.
alter table access_codes drop column if exists role;

-- ------------------------------------------------------------
-- 2. The person the archive is for
-- ------------------------------------------------------------
-- A single row describing Margaret, shown at the top of every admin view.
create table if not exists settings (
  id boolean primary key default true check (id),
  display_name text not null default 'Margaret',
  full_name text,
  birth_date date,
  residence text,
  preferred_language text default 'Français',
  care_since date,
  note text,
  photo_path text,
  updated_at timestamptz not null default now()
);

insert into settings (id) values (true) on conflict (id) do nothing;

alter table settings enable row level security;

commit;

-- ------------------------------------------------------------
-- Verification — every `ok` must be true. No rows means it did not run.
-- ------------------------------------------------------------
select 'people.role added' as check,
       exists (select 1 from information_schema.columns
               where table_name = 'people' and column_name = 'role') as ok
union all
select 'people.status added',
       exists (select 1 from information_schema.columns
               where table_name = 'people' and column_name = 'status')
union all
select 'access_codes.role removed',
       not exists (select 1 from information_schema.columns
                   where table_name = 'access_codes' and column_name = 'role')
union all
select 'settings table created',
       exists (select 1 from information_schema.tables where table_name = 'settings')
union all
select 'settings has exactly one row',
       (select count(*) = 1 from settings)
union all
select 'admin role survived the move',
       exists (select 1 from people where role = 'admin');
