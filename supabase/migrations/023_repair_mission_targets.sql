-- 023: Repair what 014 and 015 wrote, and stop structural migrations seeding.
--
-- M21. `014_mission_targets.sql` pointed missions at "the channel numbered 1"
-- with a `limit 1` across every archive, and `015_mission_media_target.sql`
-- inserted a demonstration mission gated on a global title check. Both were
-- written when one family existed. With signup live they would run against
-- whatever data exists then — and a mission in one archive could be pointed
-- at a channel in another.
--
-- 014 and 015 are left exactly as they are: they have been applied, and
-- rewriting an applied migration makes a fresh install and an existing
-- project diverge silently. This fixes forward.

-- ── Cross-archive targets: a wrong target is worse than none ─────────────

update missions m
   set channel_id = null
  from channels c
 where c.id = m.channel_id
   and c.archive_id is distinct from m.archive_id;

update missions m
   set media_id = null
  from media_files f
 where f.id = m.media_id
   and f.archive_id is distinct from m.archive_id;

/*
 * The demo mission from 015 — but only where it is still a demonstration.
 *
 * If somebody has taken it on, it stopped being seeded content the moment
 * they did: it is their record of work, and deleting it would rewrite their
 * history to tidy ours. Untouched, it is noise nobody asked for and it goes.
 * Matched on the exact title *and* on being untouched, so nothing a person
 * wrote or worked is at risk.
 */
delete from missions
 where title = 'Add a description to photo 4 in Channel 01'
   and status = 'suggested'
   and assigned_to is null
   and completed_at is null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'no mission points outside its archive (channel)' as check,
       case when not exists (
         select 1 from missions m join channels c on c.id = m.channel_id
          where c.archive_id is distinct from m.archive_id
       ) then 'OK' else 'CROSS-ARCHIVE' end as result
union all
select 'no mission points outside its archive (media)',
       case when not exists (
         select 1 from missions m join media_files f on f.id = m.media_id
          where f.archive_id is distinct from m.archive_id
       ) then 'OK' else 'CROSS-ARCHIVE' end
union all
select 'no untouched demo mission remains',
       case when not exists (
         select 1 from missions
          where title = 'Add a description to photo 4 in Channel 01'
            and status = 'suggested' and assigned_to is null and completed_at is null
       ) then 'OK' else 'STILL SEEDED' end
union all
select 'demo missions somebody actually worked are kept',
       coalesce((
         select count(*)::text from missions
          where title = 'Add a description to photo 4 in Channel 01'
       ), '0');
