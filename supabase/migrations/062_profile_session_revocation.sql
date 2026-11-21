-- 062 — A profile sign-out revokes copied profile cookies.
--
-- Device/profile sessions use signed JWTs. Clearing a browser cookie alone
-- did not invalidate a copied token, so an administrator who stepped away
-- could remain usable until its eight-hour expiry. This per-person cutoff is
-- stamped on sign-out and compared with the JWT's issued-at time on every
-- privileged read and write.

alter table people
  add column if not exists profile_sessions_valid_from timestamptz;

comment on column people.profile_sessions_valid_from is
  'Profile JWTs issued before this instant are invalid (062). Stamped when a local profile signs out.';

select 'profile session cutoff exists' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'people'
           and column_name = 'profile_sessions_valid_from'
           and data_type = 'timestamp with time zone'
       ) then 'OK' else 'MISSING' end as result;
