-- ============================================================
-- 053 — where the postcards go (backlog #9, owner-directed)
-- ============================================================
--
-- The product has never held a POSTAL address. `settings.residence` is the
-- profile's "Living place" — a town, a neighbourhood, the answer to "where
-- does she live" — and the send flow has been honest about that limit since
-- 18f: enough to confirm against, not enough to print a label from. Now the
-- owner is about to print labels: the first wave of postcards is fulfilled
-- by hand, off the /owner queue, and a queue without an address is a list of
-- promises nobody can keep.
--
-- One column, on settings, because that is the row that IS the archive's
-- subject: the address belongs to the person the cards go to, not to any
-- card ("change it once and every card follows" — 18f's rule, now with a
-- real column under it). Free text, multi-line, exactly as it should appear
-- on the envelope: address formats differ by country and a structured form
-- would validate Belgian addresses and mangle everyone else's.

alter table settings add column if not exists delivery_address text;

comment on column settings.delivery_address is
  'The postal address postcards are sent to, as it appears on the envelope. '
  'Admin-edited (backlog #9). Read by the send flow and the owner fulfilment '
  'queue; never by any display route.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'column exists' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'settings' and column_name = 'delivery_address')
            then 'OK' else 'MISSING' end as result
union all
select 'rls still enabled on settings',
       case when (select relrowsecurity from pg_class where relname = 'settings')
            then 'OK' else 'RLS OFF' end;
