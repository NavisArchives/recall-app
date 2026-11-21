-- 019: One open mission per finding, enforced by the database.
--
-- Two dashboards loading at once both ran the rule engine, and both wrote
-- the same mission before either could see the other's — a plain index
-- watches, a unique one refuses. Older duplicates are completed (not
-- deleted: they are history), keeping the earliest row as the real one.

with ranked as (
  select id, row_number() over (
    partition by channel_id, rule_key order by created_at
  ) as rn
  from missions
  where origin = 'recall' and status != 'completed' and archived_at is null
)
update missions set status = 'completed', completed_at = now()
where id in (select id from ranked where rn > 1);

drop index if exists missions_recall_open_idx;
create unique index missions_recall_open_idx
  on missions (channel_id, rule_key)
  where origin = 'recall' and status != 'completed' and archived_at is null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'index is unique' as check,
       case when exists (
         select 1 from pg_indexes
         where indexname = 'missions_recall_open_idx' and indexdef like 'CREATE UNIQUE%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'no open duplicates',
       case when not exists (
         select channel_id from missions
         where origin = 'recall' and status != 'completed' and archived_at is null
         group by channel_id, rule_key having count(*) > 1
       ) then 'OK' else 'DUPES' end;
