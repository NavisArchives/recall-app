-- 066 — Mail is counted where every instance can see the count
--
-- Four messages can be sent by anyone, with no session and no proof of owning
-- an address: the sign-up verification code, the "this address already has an
-- archive" notice, and both ends of the request-invite form (the receipt to
-- the stranger and the notice to the platform owner). The only thing between
-- a script and Recall's mail account was express-rate-limit: per IP, and held
-- in the memory of one process. A second Cloud Run instance halves it, a
-- restart forgets it, and a hundred addresses in a botnet never trip it. The
-- security review of 29 Sep 2026 (edge-1, input-2) named the result: Recall's
-- own Gmail account made to write to any inbox, as often as asked, until Gmail
-- suspends it — and with it every PIN, invitation and recovery link families
-- rely on.
--
-- So every send now asks this table first, through one function:
--
--   - three public messages per inbox per hour, in each pool the backend
--     names (the sign-up code and the account-exists notice share one, the
--     request-invite receipt has its own; the notice to the platform owner,
--     always one fixed address, is in none and only the daily share bounds
--     it);
--   - 400 messages a day in all, under Gmail's 500;
--   - public mail stops at 300 of those, so strangers can never spend the
--     share that families' invitations and recovery links need.
--
-- The limits themselves are passed in by the backend (services/email.ts) so
-- they live in one place with their reasons; this function only counts and
-- records, atomically. Counting in one statement and recording in another
-- would let two instances both see two sends and both send the third, so
-- the claim takes a transaction-scoped advisory lock: at a few hundred
-- messages a day, one claim at a time costs nothing.
--
-- The recipient is stored as a keyed hash of the inbox (HMAC under
-- CODE_PEPPER), never the address: a table that counts sends must not become
-- a list of who was mailed. "The inbox" is the lower-cased address with any
-- +tag removed, and for Gmail its dots too (services/email.ts
-- canonicalMailbox), so jan+1@ and jan+2@ do not get a budget each. Rows older than the longest window are
-- deleted on each claim, so it never grows past a day or so of mail.
--
-- Like every table in this schema: RLS on, no policies, nothing granted to
-- anon or authenticated. The function is service_role-only, like 037's.

create table if not exists mail_sends (
  id uuid primary key default gen_random_uuid(),
  recipient_hash text not null,
  template text not null,
  created_at timestamptz not null default now()
);

alter table mail_sends enable row level security;

revoke all on table mail_sends from anon, authenticated;

comment on table mail_sends is
  'One row per email the backend sent (066). recipient_hash is an HMAC of the '
  'canonical inbox, never the address. Written and pruned only by '
  'claim_mail_send; read by nothing else.';

create index if not exists mail_sends_by_recipient
  on mail_sends (recipient_hash, created_at desc);

create index if not exists mail_sends_by_time
  on mail_sends (created_at desc);

-- ── One call counts, decides and records ─────────────────────────────────

create or replace function claim_mail_send(
  p_recipient_hash    text,
  p_template          text,
  p_counted_templates text[],
  p_recipient_limit   integer,
  p_recipient_window  interval,
  p_global_limit      integer,
  p_global_window     interval
)
returns table (allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- One claim at a time, across every instance and connection. Released at
  -- the end of this call's transaction.
  perform pg_advisory_xact_lock(hashtext('claim_mail_send'));

  delete from mail_sends
   where mail_sends.created_at < now() - greatest(p_recipient_window, p_global_window);

  -- The day's budget, counted over every message sent.
  if (select count(*) from mail_sends
       where mail_sends.created_at > now() - p_global_window) >= p_global_limit then
    return query select false;
    return;
  end if;

  -- The recipient's budget, counted only over the mail a stranger can
  -- trigger, and only when this message is one of those.
  if p_template = any(coalesce(p_counted_templates, '{}'::text[]))
     and (select count(*) from mail_sends
           where mail_sends.recipient_hash = p_recipient_hash
             and mail_sends.template = any(p_counted_templates)
             and mail_sends.created_at > now() - p_recipient_window) >= p_recipient_limit then
    return query select false;
    return;
  end if;

  insert into mail_sends (recipient_hash, template)
  values (p_recipient_hash, p_template);

  return query select true;
end;
$$;

revoke all on function claim_mail_send(text, text, text[], integer, interval, integer, interval)
  from public, anon, authenticated;
grant execute on function claim_mail_send(text, text, text[], integer, interval, integer, interval)
  to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'mail_sends exists' as check,
       case when to_regclass('public.mail_sends') is not null
            then 'OK' else 'MISSING' end as result
union all
select 'mail_sends has RLS enabled',
       case when (select relrowsecurity from pg_class where oid = 'public.mail_sends'::regclass)
            then 'OK' else 'RLS OFF' end
union all
select 'mail_sends has no policies',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mail_sends')
            then 'OK' else 'HAS A POLICY' end
union all
select 'anon cannot read mail_sends',
       case when not has_table_privilege('anon', 'public.mail_sends', 'select')
            then 'OK' else 'ANON CAN SELECT' end
union all
select 'authenticated cannot write mail_sends',
       case when not has_table_privilege('authenticated', 'public.mail_sends', 'insert')
            then 'OK' else 'AUTHENTICATED CAN INSERT' end
union all
select 'claim_mail_send exists',
       case when to_regprocedure('claim_mail_send(text, text, text[], integer, interval, integer, interval)') is not null
            then 'OK' else 'MISSING' end
union all
select 'anon cannot claim a send',
       case when not has_function_privilege('anon',
              'claim_mail_send(text, text, text[], integer, interval, integer, interval)', 'execute')
            then 'OK' else 'OPEN' end
union all
select 'authenticated cannot claim a send',
       case when not has_function_privilege('authenticated',
              'claim_mail_send(text, text, text[], integer, interval, integer, interval)', 'execute')
            then 'OK' else 'OPEN' end
union all
select 'service_role can claim a send',
       case when has_function_privilege('service_role',
              'claim_mail_send(text, text, text[], integer, interval, integer, interval)', 'execute')
            then 'OK' else 'NOT GRANTED' end;
