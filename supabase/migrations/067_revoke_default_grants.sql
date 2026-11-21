-- 067 — anon and authenticated hold nothing, and the server can check it
--
-- Recall's database has one reader and one writer: the backend, holding the
-- service-role key. The browser never talks to Supabase. Since 001 the lock on
-- that has been row level security, enabled on every table with no policy at
-- all, so the anon and authenticated roles match zero rows whatever they ask.
-- That was honest, and it still holds: no migration has ever created a policy.
--
-- But it was the ONLY lock. Supabase grants anon and authenticated full table
-- privileges by default — on every existing table, and through default
-- privileges on every table created later — and no migration ever took them
-- back. The migrations run as raw SQL through the Management API, so each new
-- table arrived with SELECT, INSERT, UPDATE and DELETE granted to the public
-- key, and was safe only because its `enable row level security` line was not
-- forgotten. One forgotten line, or one `create policy ... using (true)`, and
-- the table is open to anybody holding the publishable key — which is in the
-- pushed history (29 Sep 2026 review, finding 23; database-3).
--
-- So this does two things:
--
-- **Takes the grants back.** Every table, view, sequence and function in
-- public loses every privilege anon and authenticated held, PUBLIC loses
-- EXECUTE on functions (anon inherits from PUBLIC, so revoking from anon
-- alone leaves the door open), and the default privileges for objects that
-- postgres creates from now on stop granting them anything — including
-- Postgres's own EXECUTE-for-PUBLIC on new functions, which is global. RLS stays exactly
-- as it is: two locks now, where there was one. service_role is granted
-- explicitly what it already had through Supabase's defaults, so the backend
-- notices nothing.
--
-- **Lets the server look.** `security_posture_report()` lists every table in
-- public without row level security, every policy in public, and every
-- privilege anon or authenticated still holds on a table, view, sequence or
-- one of our own functions. `schemaPreflight.ts` calls it at boot beside the
-- column check, and treats a non-empty answer the way it treats a missing
-- column — except that it never stops the server: it is logged at error
-- level and the server serves (schemaPreflight.ts bootDecision). The check
-- runs on every container start, including a replacement instance of the
-- revision already serving, where there is no previous revision to fall back
-- to; a posture alarm must not take her display down. Before this migration
-- runs the function does not exist, and the preflight reports that too — so
-- apply 067 before deploying the build that calls it.
--
-- A grant on some COLUMNS counts as a grant: `grant select (email) on people
-- to anon` is invisible to has_table_privilege, and it is exactly the
-- contact-detail columns CLAUDE.md protects. So SELECT, INSERT, UPDATE and
-- REFERENCES are asked with has_any_column_privilege, which is true for a
-- table-level grant as well; DELETE, TRUNCATE and TRIGGER exist only per
-- table.
--
-- Objects that belong to an extension are left out of every branch — tables,
-- sequences and functions alike. This migration cannot always revoke on them
-- (postgres may not own them), they are not the product's data, and the
-- classic case, PostGIS's spatial_ref_sys in public, ships with RLS off and
-- Supabase's grants. Reporting what nothing here can fix would make the
-- report permanently non-empty, and an alarm that is always on is one nobody
-- reads.
--
-- The default-privilege changes name the role that creates the objects.
-- Migrations are believed to run as postgres (scripts/run-migration.mjs
-- posts to the Management API), but nothing in the repo proved it; if they
-- ran as another role, that role's Supabase defaults would still grant
-- everything on every new table while the checklist said OK. So the same
-- changes are also made for whichever role runs this, and the checklist says
-- which role that was.

-- ── Take the grants back ─────────────────────────────────────────────────

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines  in schema public from public, anon, authenticated;

-- The backend's key keeps everything it had. Idempotent, and a no-op where
-- Supabase's defaults already granted it.
grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all routines  in schema public to service_role;

-- And the next table does not arrive open. Migrations run as postgres, so
-- these are postgres's defaults — the ones Supabase set to grant everything.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- EXECUTE for PUBLIC on a new function is Postgres's built-in default, not a
-- schema's, and a per-schema rule cannot take it away — only this global
-- form can. Without it every function created after this migration is
-- callable by anon again the moment it exists.
alter default privileges for role postgres
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- And for the role actually running this, if it is not postgres: objects a
-- later migration creates belong to that role, and take its defaults.
do $$
begin
  if current_user <> 'postgres' then
    execute format('alter default privileges for role %I in schema public revoke all on tables from anon, authenticated', current_user);
    execute format('alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated', current_user);
    execute format('alter default privileges for role %I in schema public revoke all on functions from anon, authenticated', current_user);
    execute format('alter default privileges for role %I revoke execute on functions from public', current_user);
    execute format('alter default privileges for role %I in schema public grant all on tables to service_role', current_user);
    execute format('alter default privileges for role %I in schema public grant all on sequences to service_role', current_user);
    execute format('alter default privileges for role %I in schema public grant execute on functions to service_role', current_user);
  end if;
end;
$$;

-- ── Let the server look ──────────────────────────────────────────────────

create or replace function security_posture_report()
returns table (problem text, object text, detail text)
language sql
stable
set search_path = public
as $$
  -- A table anyone could read if a grant came back. Extension members are
  -- left out here and below, as functions are (see the header).
  select 'rls_disabled'::text,
         c.relname::text,
         'row level security is not enabled'::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
     )

  union all

  -- Deny-all means no policy at all; any policy is a door somebody opened.
  select 'policy',
         p.tablename::text,
         'policy "' || p.policyname || '" (' || p.cmd || ' to '
           || array_to_string(p.roles, ', ') || ')'
    from pg_policies p
   where p.schemaname = 'public'

  union all

  -- Both privilege functions count what the role inherits from PUBLIC too.
  -- has_any_column_privilege also sees a grant on a single column, which
  -- has_table_privilege does not; it is true for a table-level grant too.
  select 'table_grant',
         c.relname::text,
         r.rolname || ' holds ' || priv.name
           || case when priv.per_column and not has_table_privilege(r.rolname, c.oid, priv.name)
                   then ' on some columns' else '' end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) as r (rolname)
   cross join (values ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', false),
                      ('TRUNCATE', false), ('REFERENCES', true), ('TRIGGER', false)) as priv (name, per_column)
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
     )
     and case when priv.per_column
              then has_any_column_privilege(r.rolname, c.oid, priv.name)
              else has_table_privilege(r.rolname, c.oid, priv.name)
         end

  union all

  select 'sequence_grant',
         c.relname::text,
         r.rolname || ' may use it'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   cross join (values ('anon'), ('authenticated')) as r (rolname)
   where n.nspname = 'public'
     and c.relkind = 'S'
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
     )
     and has_sequence_privilege(r.rolname, c.oid, 'USAGE, SELECT, UPDATE')

  union all

  select 'function_grant',
         p.oid::regprocedure::text,
         r.rolname || ' may execute it'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated')) as r (rolname)
   where n.nspname = 'public'
     and not exists (
       select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
     )
     and has_function_privilege(r.rolname, p.oid, 'EXECUTE')

   order by 1, 2, 3;
$$;

-- The report names every table and function; it is the backend's to read.
revoke all on function security_posture_report() from public, anon, authenticated;
grant execute on function security_posture_report() to service_role;

comment on function security_posture_report() is
  'Every departure from deny-all in schema public: tables without RLS, any policy, any privilege anon/authenticated hold (067). Empty means healthy. Called by schemaPreflight.ts at boot.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'migrations run as postgres' as check,
       case when current_user = 'postgres' then 'OK'
            else 'RAN AS ' || current_user || ' (its defaults were changed too; check new tables)' end as result
union all
select 'security_posture_report exists',
       case when to_regprocedure('security_posture_report()') is not null
            then 'OK' else 'MISSING' end
union all
select 'security_posture_report is service_role only',
       case when not has_function_privilege('anon', 'security_posture_report()', 'execute')
             and not has_function_privilege('authenticated', 'security_posture_report()', 'execute')
             and has_function_privilege('service_role', 'security_posture_report()', 'execute')
            then 'OK' else 'WRONG GRANTS' end
union all
select 'no table without row level security',
       case when not exists (select 1 from security_posture_report() where problem = 'rls_disabled')
            then 'OK' else 'RLS OFF ON ' || (select string_agg(object, ', ') from security_posture_report() where problem = 'rls_disabled') end
union all
select 'no policy in public',
       case when not exists (select 1 from security_posture_report() where problem = 'policy')
            then 'OK' else 'POLICY ON ' || (select string_agg(object, ', ') from security_posture_report() where problem = 'policy') end
union all
select 'anon and authenticated hold nothing',
       case when not exists (select 1 from security_posture_report() where problem like '%_grant')
            then 'OK' else 'STILL GRANTED: ' || (select string_agg(distinct object, ', ') from security_posture_report() where problem like '%_grant') end
union all
select 'service_role still reads people',
       case when has_table_privilege('service_role', 'public.people', 'SELECT')
             and has_table_privilege('service_role', 'public.people', 'INSERT')
             and has_table_privilege('service_role', 'public.people', 'UPDATE')
             and has_table_privilege('service_role', 'public.people', 'DELETE')
            then 'OK' else 'SERVICE ROLE LOCKED OUT' end
union all
select 'new tables are not granted to anon',
       case when not exists (
              select 1
                from pg_default_acl d
                join pg_namespace n on n.oid = d.defaclnamespace
               cross join lateral aclexplode(d.defaclacl) a
               where n.nspname = 'public'
                 and d.defaclrole in ('postgres'::regrole, current_user::text::regrole)
                 and d.defaclobjtype in ('r', 'S', 'f')
                 and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
            )
            then 'OK' else 'DEFAULT PRIVILEGES STILL GRANT' end
union all
select 'new functions are not executable by PUBLIC',
       case when exists (
              select 1
                from pg_default_acl d
               where d.defaclrole = 'postgres'::regrole
                 and d.defaclnamespace = 0
                 and d.defaclobjtype = 'f'
                 and not exists (
                   select 1 from aclexplode(d.defaclacl) a where a.grantee = 0
                 )
            )
            then 'OK' else 'PUBLIC STILL EXECUTES NEW FUNCTIONS' end;
