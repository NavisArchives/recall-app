-- 045 — Channel 11 stops being special
--
-- 11 was reserved for a screen that gathered every instruction channel into a
-- menu. The owner's decision, 21 Aug 2026: an instruction IS a channel, and it
-- already has its own number. "Making coffee" is channel 03 in the scratch
-- archive and Margaret reaches it by scanning or typing 03, exactly as she
-- reaches an album. A separate screen re-listing 03 and 05 one level deeper
-- duplicated them and gave her two ways to reach the same thing — one more
-- than a person with Alzheimer's should have to hold.
--
-- So the screen goes, and 11 becomes assignable content like any other number.
-- 00 overview, 10 social, 98 home and 99 admin stay reserved: those are real
-- destinations with no channel behind them.
--
-- Safe to run: no channel anywhere is numbered 11 (the constraint has forbidden
-- it since 001), so relaxing the constraint cannot make an existing row
-- invalid. NFC cards link by `channel_id`, not by number, so no card mapping
-- changes meaning. This migration only widens what is permitted.

alter table channels drop constraint if exists channels_number_check;
alter table channels add constraint channels_number_check
  check (number between 1 and 99 and number not in (10, 98, 99));

-- ── Self-verifying checklist ─────────────────────────────────────────────

select '11 is now permitted' as check,
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'channels_number_check') not like '%11%'
            then 'OK' else 'STILL RESERVED' end as result
union all
select 'the other four are still reserved',
       case when (select bool_and(pg_get_constraintdef(oid) like '%' || v || '%')
                  from pg_constraint, unnest(array['10','98','99']) v
                  where conname = 'channels_number_check')
            then 'OK' else 'A RESERVATION WAS LOST' end
union all
/*
  0 is excluded by the range, not by the list, so the range has to be checked
  separately — but NOT by grepping for "between 1 and 99". Postgres normalises
  BETWEEN into >= AND <= when it stores a constraint, so that string can never
  appear and this check reported RANGE LOST on a perfectly correct migration.
  A check that fails for the wrong reason costs exactly what one that passes
  for the wrong reason costs: somebody acts on it. Ask the database whether
  the values are refused, rather than asking the text what it looks like.
*/
select 'zero and out-of-range still refused',
       case when (select bool_and(
                    pg_get_constraintdef(oid) like '%number >= 1%'
                    and pg_get_constraintdef(oid) like '%number <= 99%')
                  from pg_constraint where conname = 'channels_number_check')
            then 'OK' else 'RANGE LOST' end
union all
select 'every existing channel still satisfies the constraint',
       case when not exists (
              select 1 from channels
              where number is not null
                and (number < 1 or number > 99 or number in (10, 98, 99)))
            then 'OK' else 'AN EXISTING ROW IS NOW INVALID' end
union all
select 'rls still enabled on channels',
       case when (select relrowsecurity from pg_class where relname = 'channels')
            then 'OK' else 'RLS OFF' end;
