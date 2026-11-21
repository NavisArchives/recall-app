-- 031 — A session that belongs to no archive (M55)
--
-- `family_sessions.archive_id` was `not null` because every session there had
-- ever been belonged to a household. The platform owner's does not: that row
-- owns no archive on purpose, so that the role can never become a way into a
-- family's memories. Signing in failed at the insert.
--
-- Nullable, plus a check that keeps the old guarantee for everyone else: a
-- session without an archive is allowed only when the family it belongs to
-- has none either — which, by 030's unique index, is at most one row, and by
-- the grant script's refusal is only ever the platform owner.

alter table family_sessions alter column archive_id drop not null;

create or replace function family_session_archive_agrees(p_family uuid, p_archive uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from families
     where families.id = p_family
       and families.archive_id is not distinct from p_archive
  );
$$;

revoke all on function family_session_archive_agrees(uuid, uuid) from public, anon, authenticated;
grant execute on function family_session_archive_agrees(uuid, uuid) to service_role;

alter table family_sessions
  drop constraint if exists family_sessions_archive_matches_family;

alter table family_sessions
  add constraint family_sessions_archive_matches_family
  check (family_session_archive_agrees(family_id, archive_id))
  not valid;

-- `not valid` deliberately: existing rows were written under the old rule and
-- are correct by construction (they all carry an archive). Validating would
-- lock the table to re-prove something already true, and a session that is
-- wrong is better ended by `readFamilySession` — which re-checks this on
-- every request anyway — than by refusing to migrate.

-- ── Self-verifying checklist ─────────────────────────────────────────────

do $$
declare
  v_family uuid;
  v_other  uuid;
begin
  insert into families (email, display_name, status, platform_owner, archive_id)
  values ('checklist-' || gen_random_uuid()::text || '@example.invalid',
          'Checklist Platform', 'active', false, null)
  returning families.id into v_family;

  -- A session with no archive, for a family with no archive: allowed.
  insert into family_sessions (family_id, archive_id, token_hash, session_version, expires_at)
  values (v_family, null, 'checklist-' || gen_random_uuid()::text, 0, now() + interval '1 hour');

  -- A session claiming an archive its family does not own: refused.
  select archives.id into v_other from archives limit 1;
  if v_other is not null then
    begin
      insert into family_sessions (family_id, archive_id, token_hash, session_version, expires_at)
      values (v_family, v_other, 'checklist-' || gen_random_uuid()::text, 0, now() + interval '1 hour');
      raise exception 'a session was allowed to claim an archive its family does not own';
    exception when check_violation then
      null;
    end;
  end if;

  delete from family_sessions where family_sessions.family_id = v_family;
  delete from families where families.id = v_family;
end $$;

select 'a family session may have no archive' as check, 'OK' as result
union all
select 'archive_id is nullable now',
       case when (
         select is_nullable from information_schema.columns
         where table_name = 'family_sessions' and column_name = 'archive_id'
       ) = 'YES' then 'OK' else 'STILL NOT NULL' end
union all
select 'but it must still agree with the family',
       case when exists (
         select 1 from pg_constraint
         where conname = 'family_sessions_archive_matches_family'
       ) then 'OK' else 'MISSING' end;
