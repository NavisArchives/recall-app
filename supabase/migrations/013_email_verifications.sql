-- 013: The founder proves their address too.
--
-- Invitees have always proved their email by possessing the code that was
-- sent to it. The person founding an archive just typed one — fine among
-- family, not fine once strangers sign up. Now the same proof applies to
-- everyone: a short code lands in the inbox, and the archive is only
-- created for an address that echoed its code back.
--
-- Rows are working state, not records: created on send, marked on check,
-- consumed by the sign-up they authorise.

create table if not exists email_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_email_idx
  on email_verifications (lower(email), created_at desc);

alter table email_verifications enable row level security;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'email_verifications table' as check,
       case when exists (select 1 from information_schema.tables
                         where table_name = 'email_verifications')
            then 'OK' else 'MISSING' end as result
union all
select 'email index',
       case when exists (select 1 from pg_indexes
                         where indexname = 'email_verifications_email_idx')
            then 'OK' else 'MISSING' end
union all
select 'rls enabled',
       case when (select relrowsecurity from pg_class where relname = 'email_verifications')
            then 'OK' else 'MISSING' end;
