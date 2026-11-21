-- 016: Four kinds of memory.
--
-- A channel was an album or a video. Two more join: a documentary — a film
-- that tells a story at length — and an instruction, photographs in order
-- whose words walk Margaret through something she does every day. The
-- display already knows how to show both: a documentary plays like a film,
-- an instruction is a sequence read one step at a time.

alter table channels drop constraint if exists channels_content_type_check;
alter table channels add constraint channels_content_type_check
  check (content_type in ('album', 'video', 'documentary', 'instruction'));

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'constraint widened' as check,
       case when exists (
         select 1 from information_schema.check_constraints
         where constraint_name = 'channels_content_type_check'
           and check_clause like '%documentary%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'existing rows still valid',
       case when not exists (
         select 1 from channels
         where content_type not in ('album','video','documentary','instruction')
       ) then 'OK' else 'INVALID ROWS' end;
