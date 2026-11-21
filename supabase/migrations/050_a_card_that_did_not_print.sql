-- ============================================================
-- 050 — a card that did not print (18j)
-- ============================================================
--
-- 049 gave the post its states: queued → printing → shipped → delivered, and
-- `returned` for a card that came back. All five describe a card that made it
-- onto paper. 18j draws a sixth row the others cannot hold:
--
--     02 — Holidays · postcard   Margaret F.   Lucie   25 Aug
--     failed        printer error        [Retry]
--
-- A card the print house could not produce is not `printing` — nothing is
-- printing — and it is certainly not `sent`. Without a state of its own it has
-- to sit lying in one of them, and the lie is the expensive kind: the family
-- is told "preparing for delivery, three or four days" (18g) and the card
-- never comes, because the row still says `printing` and nobody is looking at
-- it. The queue's whole job is that somebody keeps that promise.
--
-- The frame's own caption says why the state stops here: "the failed row keeps
-- the retry here so the family never sees a printer error". So the reason is
-- stored beside the state, and the workspace never reads either — 18k shows a
-- family the delivery failures that concern them (a card came back, check the
-- address) and nothing about our printer.
--
-- WHY A REASON COLUMN AND NOT A CODE: whoever processes the queue is typing
-- what the print house told them. A closed list would need extending every
-- time a supplier invents a new way to fail, and an operator faced with a list
-- that does not fit picks the nearest wrong one. Free text is read by a person
-- and only by a person.

alter table nfc_cards drop constraint if exists nfc_cards_state_check;
alter table nfc_cards add constraint nfc_cards_state_check
  check (state is null or state in (
    'draft', 'ready', 'queued', 'printing', 'shipped', 'sent', 'delivered',
    'returned', 'failed'
  ));

alter table nfc_cards add column if not exists failure_reason text;
alter table nfc_cards add column if not exists failed_at timestamptz;

comment on column nfc_cards.failure_reason is
  'Internal only (18j). What the print house said. Never shown in the family workspace.';

-- Write one, so the checklist below reads a fact rather than a constraint.
insert into nfc_cards (archive_id, label, kind, state, failure_reason)
select id, '050 probe', 'postcard', 'failed', '050 probe' from archives limit 1;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'failed is permitted' as check,
       case when (select pg_get_constraintdef(oid) from pg_constraint
                  where conname = 'nfc_cards_state_check') like '%''failed''%'
            then 'OK' else 'MISSING' end as result
union all
select 'every state 047-049 defined survives',
       case when (select bool_and(pg_get_constraintdef(oid) like '%''' || v || '''%')
                  from pg_constraint,
                       unnest(array['draft','ready','queued','printing','shipped',
                                    'sent','delivered','returned']) v
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
                    and column_name in ('failure_reason', 'failed_at')) = 2
            then 'OK' else 'A COLUMN IS MISSING' end
union all
-- A state nothing can reach is worse than no state: it looks handled. The
-- probe above asserts the value is actually writable, not merely spelled in a
-- constraint — a check constraint can permit a value the column's type or a
-- trigger still refuses.
select 'a card can actually be written as failed',
       case when exists (select 1 from nfc_cards
                         where label = '050 probe' and state = 'failed')
            then 'OK' else 'COULD NOT WRITE' end
union all
select 'rls still enabled on nfc_cards',
       case when (select relrowsecurity from pg_class where relname = 'nfc_cards')
            then 'OK' else 'RLS OFF' end;

-- The probe row is not a card anyone made. Remove it.
delete from nfc_cards where label = '050 probe' and failure_reason = '050 probe';
