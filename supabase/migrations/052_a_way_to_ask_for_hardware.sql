-- ============================================================
-- 052 — a way to ask for hardware (owner-directed)
-- ============================================================
--
-- The workspace gets a Devices page: the family's screens, and the equipment
-- Recall can send — a screen, the card reader with its keyboard dock, the
-- hub. The owner's words: "you get an explanation on how it works, and then
-- you are able to order one."
--
-- There is no payment and no fulfilment pipeline for hardware yet, so an
-- order is a REQUEST: a row saying which family asked for which thing, read
-- from the owner surface the same way the postcard queue is. When ordering
-- becomes real commerce this table is the audit trail of the era before it.
--
-- `device_kind` is a check constraint rather than free text because the
-- catalogue is ours: the family picks from what exists, and a typo cannot
-- invent a product.

create table if not exists device_requests (
  id uuid primary key default gen_random_uuid(),
  archive_id uuid not null references archives(id) on delete cascade,
  device_kind text not null check (device_kind in ('screen', 'reader_dock', 'hub')),
  note text,
  requested_by uuid references people(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

alter table device_requests enable row level security;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'table exists' as check,
       case when exists (select 1 from information_schema.tables
                         where table_name = 'device_requests')
            then 'OK' else 'MISSING' end as result
union all
select 'rls enabled with no permissive policies',
       case when (select relrowsecurity from pg_class where relname = 'device_requests')
             and not exists (select 1 from pg_policies where tablename = 'device_requests')
            then 'OK' else 'OPEN' end
union all
select 'the three kinds are permitted and nothing else',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint, unnest(array['screen','reader_dock','hub']) v
                  where conname = 'device_requests_device_kind_check')
            then 'OK' else 'MISSING' end
union all
select 'archive scoped',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'device_requests' and column_name = 'archive_id'
                           and is_nullable = 'NO')
            then 'OK' else 'UNSCOPED' end;
