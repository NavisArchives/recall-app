-- 015: A mission can point at one photograph.
--
-- "Describe photo 4 in channel 01" is a different promise from "describe
-- the photos": pressing it must land on that photo with the ring already
-- around its description. The target is a real foreign key, so the mission
-- follows the photo — and dies with it — rather than being a note about it.

alter table missions add column if not exists media_id uuid references media_files(id) on delete set null;

-- Seed the example: the fourth photo of channel 01, by shelf order.
insert into missions (archive_id, channel_id, media_id, title, detail, status, task_kind, task_count)
select c.archive_id, c.id, m.id,
       'Add a description to photo 4 in Channel 01',
       'One photograph in "' || c.title || '" still has no words.',
       'suggested', 'describe_photos', 1
from channels c
join lateral (
  select id from media_files
  where channel_id = c.id and archived_at is null and file_type = 'image'
  order by display_order offset 3 limit 1
) m on true
where c.number = 1 and c.archived_at is null
  and not exists (select 1 from missions where title = 'Add a description to photo 4 in Channel 01');

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'missions.media_id' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'missions' and column_name = 'media_id')
            then 'OK' else 'MISSING' end as result
union all
select 'photo mission seeded',
       case when exists (select 1 from missions where media_id is not null)
            then 'OK' else 'CHECK MANUALLY' end;
