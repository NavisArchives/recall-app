-- ============================================================
-- 049 — the states a card passes through in the post (18h, 18j, 18k)
-- ============================================================
--
-- 047/048 gave a postcard five states, which was every state the OVERVIEW
-- needed. The frames that show the inside of the operation need three more:
--
--   18j, the fulfilment queue, lists `queued`, `printing` and `shipped` as
--   distinct rows an operator acts on differently — you process a queued
--   card, you wait on a printing one, you track a shipped one.
--
--   18k has a FAILED DELIVERY panel: "It came back to us on 30 August. The
--   address may be wrong." A card that came back is not `sent` and is not
--   `delivered`; without a state of its own it would have to sit lying in one
--   of them.
--
-- 18h's timeline reads CREATED → PREPARED → PRINTED → SHIPPED → DELIVERED,
-- which is the same ladder seen from the family's side.
--
-- `sent` stays permitted. It is the word the family reads (18a's pill, 18h's
-- SENT date) for a card that has left us, and the UI maps the operational
-- states onto it — the same split as `queued` being shown as "preparing for
-- delivery" (18g). Removing it would break rows that already use it.

alter table nfc_cards drop constraint if exists nfc_cards_state_check;
alter table nfc_cards add constraint nfc_cards_state_check
  check (state is null or state in (
    'draft', 'ready', 'queued', 'printing', 'shipped', 'sent', 'delivered', 'returned'
  ));

-- When it came back, and who was carrying it. `shipping_reference` (047) is
-- the tracking number; the carrier is the other half of "bpost · JJBE2214".
alter table nfc_cards add column if not exists returned_at timestamptz;
alter table nfc_cards add column if not exists shipping_carrier text;

comment on column nfc_cards.returned_at is
  'A card that came back undelivered (18k). Not sent, not delivered — its own fact.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'the three new states are permitted' as check,
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint, unnest(array['printing','shipped','returned']) v
                  where conname = 'nfc_cards_state_check')
            then 'OK' else 'MISSING' end as result
union all
select 'every state 047 and 048 defined survives',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint, unnest(array['draft','ready','queued','sent','delivered']) v
                  where conname = 'nfc_cards_state_check')
            then 'OK' else 'A STATE WAS DROPPED' end
union all
select 'a tag may still have no state',
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'nfc_cards_state_check') like '%IS NULL%'
            then 'OK' else 'NULL NO LONGER ALLOWED' end
union all
select 'both new columns exist',
       case when (select count(*) from information_schema.columns
                  where table_name = 'nfc_cards'
                    and column_name in ('returned_at','shipping_carrier')) = 2
            then 'OK' else 'A COLUMN IS MISSING' end
union all
select 'every existing card still satisfies the constraint',
       case when not exists (
              select 1 from nfc_cards where state is not null
                and state not in ('draft','ready','queued','printing','shipped','sent','delivered','returned'))
            then 'OK' else 'AN EXISTING ROW IS NOW INVALID' end
union all
select 'the postcard-must-have-a-state rule is untouched',
       case when exists (select 1 from pg_constraint
                         where conname = 'nfc_cards_postcard_has_state')
            then 'OK' else 'LOST' end;
