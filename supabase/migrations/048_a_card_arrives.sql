-- ============================================================
-- 048 — a card arrives (design 18a's seventh filter)
-- ============================================================
--
-- 047 gave a postcard four states: draft, ready, queued, sent. Frame 18a
-- filters on a fifth — Delivered — and it is a different fact from `sent`:
-- `sent` is the day Recall put it in the post, `delivered` is the day it
-- reached her hall floor. A family reading "sent" three weeks later cannot
-- tell whether it arrived, and that is the one question they actually have.
--
-- Caught while building the overview against the frame rather than against
-- the schema, which is the right direction for that comparison to run.
--
-- `active` in 18a is NOT a state and is deliberately not added: it is the
-- word the overview shows for an NFC tag, whose state is null by design (047)
-- because a tag has no send lifecycle. It is derived, not stored.

alter table nfc_cards drop constraint if exists nfc_cards_state_check;
alter table nfc_cards add constraint nfc_cards_state_check
  check (state is null or state in ('draft', 'ready', 'queued', 'sent', 'delivered'));

alter table nfc_cards add column if not exists delivered_at timestamptz;

comment on column nfc_cards.delivered_at is
  'When it reached her, not when it was posted — sent_at is the other one (048).';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'delivered is now a permitted state' as check,
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'nfc_cards_state_check') like '%delivered%'
            then 'OK' else 'MISSING' end as result
union all
select 'the four states 047 defined all survive',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint, unnest(array['draft','ready','queued','sent']) v
                  where conname = 'nfc_cards_state_check')
            then 'OK' else 'A STATE WAS DROPPED' end
union all
select 'a tag may still have no state at all',
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'nfc_cards_state_check') like '%IS NULL%'
            then 'OK' else 'NULL NO LONGER ALLOWED' end
union all
select 'delivered_at exists',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'nfc_cards' and column_name = 'delivered_at')
            then 'OK' else 'MISSING' end
union all
select 'every existing card still satisfies the constraint',
       case when not exists (
              select 1 from nfc_cards
              where state is not null
                and state not in ('draft','ready','queued','sent','delivered'))
            then 'OK' else 'AN EXISTING ROW IS NOW INVALID' end
union all
select 'the postcard-must-have-a-state rule is untouched',
       case when exists (select 1 from pg_constraint
                         where conname = 'nfc_cards_postcard_has_state')
            then 'OK' else 'LOST' end;
