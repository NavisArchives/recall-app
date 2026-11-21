-- 012: A contributor may leave an address.
--
-- The joining screen offers it as an optional line — useful to a family
-- organising visits, never required. A field the interface shows must have
-- somewhere real to go; anything else is theatre.

alter table people add column if not exists address text;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'people.address' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'people' and column_name = 'address')
            then 'OK' else 'MISSING' end as result;
