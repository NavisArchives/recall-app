-- 017: Missions that Recall itself suggests.
--
-- The sidebar's "needs attention" list stops being commentary: every open
-- finding on a channel becomes one individual mission — "Link a card to
-- Channel 04", not "4 channels without an NFC card". The rule engine
-- creates them, and completes them the moment the finding resolves, the
-- same way every mission concludes: by the work actually happening.
--
-- origin marks who wrote the mission ('human' or 'recall'); rule_key ties
-- a recall mission to the finding it mirrors, so the engine can find its
-- own missions without ever touching a person's.

alter table missions add column if not exists origin text not null default 'human'
  check (origin in ('human', 'recall'));
alter table missions add column if not exists rule_key text;

create index if not exists missions_recall_open_idx
  on missions (channel_id, rule_key)
  where origin = 'recall' and status != 'completed';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'origin column' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'missions' and column_name = 'origin'
       ) then 'OK' else 'MISSING' end as result
union all
select 'rule_key column',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'missions' and column_name = 'rule_key'
       ) then 'OK' else 'MISSING' end
union all
select 'existing missions are human',
       case when not exists (
         select 1 from missions where origin not in ('human', 'recall')
       ) then 'OK' else 'INVALID' end
union all
select 'recall index',
       case when exists (
         select 1 from pg_indexes
         where tablename = 'missions' and indexname = 'missions_recall_open_idx'
       ) then 'OK' else 'MISSING' end;
