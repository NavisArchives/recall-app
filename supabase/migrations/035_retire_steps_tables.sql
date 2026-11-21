-- 035 — The parallel guide storage retires (M92)
--
-- `steps` and `step_items` were the display's first guide: one hardcoded
-- routine, served by /api/steps, with full CRUD and no management screen that
-- could reach it. A family could never write one, and a channel could never
-- become one — so the product had two ways to store a set of instructions and
-- only one of them belonged to anybody.
--
-- M91 gave instruction *channels* the guide presentation, and M92 pointed
-- channel 11 at them. Every guide is now an ordinary channel: same archive
-- scoping, same RLS, same media, same editor the family already uses. These
-- two tables have no reader left in the codebase — the routes, the prefetch
-- pass, the media resolver and the frontend page all went with the same
-- commit.
--
-- Dropped rather than left empty. A table with no reader is not free: it is a
-- second place a future writer might reasonably put a guide, which is exactly
-- the split this retires. One format, one storage (M38).

drop table if exists step_items;
drop table if exists steps;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'the steps table is gone' as check,
       case when not exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'steps'
       ) then 'OK' else 'STILL PRESENT' end as result

union all

select 'the step_items table is gone',
       case when not exists (
         select 1 from information_schema.tables
         where table_schema = 'public' and table_name = 'step_items'
       ) then 'OK' else 'STILL PRESENT' end

union all

-- The invariant this migration must not weaken: nothing in the schema may
-- carry rows without RLS enabled. Dropping tables cannot break it, but the
-- check is cheap and this is the file that would notice.
select 'every public table still has RLS enabled',
       case when not exists (
         select 1 from pg_tables t
         join pg_class c on c.relname = t.tablename
         where t.schemaname = 'public' and not c.relrowsecurity
       ) then 'OK' else 'A TABLE IS UNPROTECTED' end;
