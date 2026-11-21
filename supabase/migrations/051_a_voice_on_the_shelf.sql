-- ============================================================
-- 051 — a voice on the shelf (spec 24b, owner-directed)
-- ============================================================
--
-- The owner's brief, verbatim in intent: a new channel type — stories — made
-- of one picture, a description, and a recorded voice message. The display
-- side is spec 24b: her screen shows the picture's room, the sender's name,
-- "Odette is talking to you.", and a waveform that fills as it plays.
--
-- Two constraints widen:
--
--   channels.content_type gains 'stories'. It is a TYPE, not a flag on an
--   album, because everything about the screen differs — no gallery, no
--   thumbnails, OK means pause, and the screen goes home when it ends.
--
--   media_files.file_type gains 'audio'. The voice IS a media file: it lives
--   in the same private bucket, travels the same signed-url route, and is
--   deleted when the channel is. A second table would re-answer questions
--   this one already answers (whose archive, which channel, who added it).
--
-- Nothing narrows, so no existing row can be made invalid.

alter table channels drop constraint if exists channels_content_type_check;
alter table channels add constraint channels_content_type_check
  check (content_type in ('album', 'video', 'documentary', 'instruction', 'stories'));

alter table media_files drop constraint if exists media_files_file_type_check;
alter table media_files add constraint media_files_file_type_check
  check (file_type in ('image', 'video', 'audio'));

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'stories is a channel type' as check,
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'channels_content_type_check') like '%''stories''%'
            then 'OK' else 'MISSING' end as result
union all
select 'every earlier channel type survives',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint,
                       unnest(array['album','video','documentary','instruction']) v
                  where conname = 'channels_content_type_check')
            then 'OK' else 'A TYPE WAS DROPPED' end
union all
select 'audio is a media type',
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'media_files_file_type_check') like '%''audio''%'
            then 'OK' else 'MISSING' end
union all
select 'image and video survive',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint, unnest(array['image','video']) v
                  where conname = 'media_files_file_type_check')
            then 'OK' else 'A TYPE WAS DROPPED' end
union all
select 'every existing media row still satisfies the constraint',
       case when not exists (select 1 from media_files
                             where file_type not in ('image','video','audio'))
            then 'OK' else 'AN EXISTING ROW IS NOW INVALID' end
union all
select 'rls still enabled on both tables',
       case when (select bool_and(relrowsecurity) from pg_class
                  where relname in ('channels', 'media_files'))
            then 'OK' else 'RLS OFF' end;
