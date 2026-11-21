-- 007: The physical half of Recall, and the family's to-do list.
--
-- nfc_cards: each physical card or object that opens a channel on
-- Margaret's screen. The card hardware types the channel digits; this
-- table is the family's registry of what each card is and where it lives.
--
-- missions: helpful tasks for keeping the archive alive. `source` carries
-- a stable key when a mission was accepted from a derived suggestion, so
-- the same suggestion is never offered twice.

create table if not exists nfc_cards (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  tag_code text,
  channel_id uuid references channels(id) on delete set null,
  linked_object text,
  linked_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  detail text,
  status text not null default 'suggested'
    check (status in ('suggested', 'in_progress', 'completed')),
  assigned_to uuid references people(id) on delete set null,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  archived_at timestamptz
);

create unique index if not exists missions_source_unique
  on missions (source) where source is not null and archived_at is null;

-- Service-role access only, like every other table: RLS on, no policies.
alter table nfc_cards enable row level security;
alter table missions enable row level security;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'nfc_cards table' as check,
       case when exists (select 1 from information_schema.tables
                         where table_name = 'nfc_cards')
            then 'OK' else 'MISSING' end as result
union all
select 'missions table',
       case when exists (select 1 from information_schema.tables
                         where table_name = 'missions')
            then 'OK' else 'MISSING' end
union all
select 'missions status check',
       case when exists (select 1 from information_schema.check_constraints
                         where constraint_name like '%missions_status_check%')
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'rls enabled',
       case when (select bool_and(relrowsecurity) from pg_class
                  where relname in ('nfc_cards', 'missions'))
            then 'OK' else 'MISSING' end;
