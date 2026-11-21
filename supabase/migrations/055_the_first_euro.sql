-- 055 — The first euro (launch sweep, 16 Sep 2026)
--
-- 27 Aug decision: manual invoices at launch. Andy approves a family, sends
-- an invoice, activates on payment. Migration 034 left a `subscription` seam
-- and deliberately nothing to interpret it; the product then had no way to
-- record that an invoice went out, that it was paid, or that a family is
-- paused for not paying. This is that record, and only that record: no
-- processor, no card, no webhook. Mollie plugs into the same columns later
-- (invoiced → active on its webhook) without a redesign.
--
-- States (families.payment_state):
--   none     — created, nothing invoiced yet (every existing family)
--   invoiced — the first invoice went out; the workspace shows it
--   active   — paid; the archive runs
--   paused   — unpaid past the grace period, or on request; the workspace
--              shows the invoice and little else; her screen keeps playing
--   closed   — ended (cancellation, bereavement); export and retention
--              follow the terms
--
-- `subscription` (034) is set to the tier name on activation so the owner
-- dashboard's existing count of subscribed families becomes true.

alter table families
  add column if not exists payment_state text not null default 'none'
    check (payment_state in ('none', 'invoiced', 'active', 'paused', 'closed')),
  add column if not exists tier text
    check (tier is null or tier in ('archive', 'control', 'connect', 'dock')),
  add column if not exists invoice_number text,
  add column if not exists invoice_amount_cents integer
    check (invoice_amount_cents is null or invoice_amount_cents >= 0),
  add column if not exists invoiced_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists activated_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists payment_note text;

comment on column families.payment_state is
  'none | invoiced | active | paused | closed — the manual-invoice state machine '
  '(055). Moved only by the platform owner''s routes; read by the family''s own '
  'workspace to show what is owed. Never read by the display.';

-- Sequential invoice numbers, issued by the database so two owner tabs can
-- never mint the same one. R-<year>-<0001>.
create sequence if not exists invoice_number_seq;

create or replace function next_invoice_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'R-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
$$;

-- Only the service role (the backend) may call it. Anonymous and signed-in
-- PostgREST callers have no business minting invoice numbers.
revoke all on function next_invoice_number() from public;
revoke all on function next_invoice_number() from anon;
revoke all on function next_invoice_number() from authenticated;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'families carries payment_state' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'families' and column_name = 'payment_state'
       ) then 'OK' else 'MISSING' end as result
union all
select 'every existing family starts at none',
       case when (select count(*) from families where payment_state <> 'none') = 0
            then 'OK' else 'UNEXPECTED STATE' end
union all
select 'invoice numbers come from the database',
       case when to_regproc('next_invoice_number') is not null then 'OK' else 'MISSING' end
union all
select 'anon cannot mint an invoice number',
       case when not has_function_privilege('anon', 'next_invoice_number()', 'execute')
            then 'OK' else 'OPEN' end
union all
select 'families invoiced so far (expected 0 on first run)',
       (select count(*)::text from families where invoice_number is not null);
