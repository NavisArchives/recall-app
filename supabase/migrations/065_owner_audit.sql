-- 065 — Every time a family's content leaves through the owner, a row says so
--
-- The platform owner's console reads information about families, never their
-- content — with two sanctioned exceptions, both narrow: the archive export
-- (M241, the drive a family keeps) and the print sheet of one queued postcard
-- (its photograph and the address it is posted to). The queue list itself
-- carries neither: it says whose card it is and whether the family has given
-- an address, and the address leaves only on that audited, stepped-up print
-- sheet, one card at a time. Until now neither exception left a
-- trace. The security review of 29 Sep 2026 (access-5) put it plainly: the
-- whole cross-family surface rested on one password, and if that password was
-- ever used by somebody else, nothing would show which families had been
-- taken off the platform or when.
--
-- So each of those acts now writes one row here, and the route refuses to
-- proceed when it cannot: an export whose audit row failed does not happen.
-- The step-up that unlocks them (password, and the authenticator code once
-- two-step sign-in is on) is recorded too, as are the changes to two-step
-- sign-in itself.
--
-- The target columns carry plain ids and no foreign keys, on purpose. An
-- audit row must outlive the family it describes: a family that later leaves
-- the platform is exactly the one whose export history someone will ask
-- about. `family_id` is the platform owner's own row, which does not leave.
--
-- Like every table in this schema: RLS on, no policies, and nothing granted
-- to anon or authenticated. Only the backend's service-role key reads or
-- writes it, and no route reads it back yet.

create table if not exists owner_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Who acted: the platform owner's families row.
  family_id uuid not null references families(id) on delete restrict,
  action text not null check (action in (
    'step_up', 'step_up_failed',
    'export',
    'print', 'print_photo',
    'totp_setup', 'totp_enabled', 'totp_disabled'
  )),
  -- What it was done to. Whichever of these the action has; all null for the
  -- owner's own security events.
  target_family_id uuid,
  archive_id uuid,
  card_id uuid,
  created_at timestamptz not null default now()
);

alter table owner_audit_log enable row level security;

revoke all on table owner_audit_log from anon, authenticated;

comment on table owner_audit_log is
  'One row per export, print, step-up and two-step change made from the '
  'platform owner console (065). Written by the backend only; a failed write '
  'refuses the act it describes.';

create index if not exists owner_audit_log_by_time
  on owner_audit_log (created_at desc);

create index if not exists owner_audit_log_by_target
  on owner_audit_log (target_family_id, created_at desc)
  where target_family_id is not null;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'owner_audit_log exists' as check,
       case when to_regclass('public.owner_audit_log') is not null
            then 'OK' else 'MISSING' end as result
union all
select 'owner_audit_log has RLS enabled',
       case when (select relrowsecurity from pg_class where oid = 'public.owner_audit_log'::regclass)
            then 'OK' else 'RLS OFF' end
union all
select 'owner_audit_log has no policies',
       case when not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'owner_audit_log')
            then 'OK' else 'HAS A POLICY' end
union all
select 'anon cannot read owner_audit_log',
       case when not has_table_privilege('anon', 'public.owner_audit_log', 'select')
            then 'OK' else 'ANON CAN SELECT' end
union all
select 'authenticated cannot write owner_audit_log',
       case when not has_table_privilege('authenticated', 'public.owner_audit_log', 'insert')
            then 'OK' else 'AUTHENTICATED CAN INSERT' end;
