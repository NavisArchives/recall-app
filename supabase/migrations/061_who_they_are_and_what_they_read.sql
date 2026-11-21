-- 061 — Who they are to her, and what they read (owner, 17 Sep 2026)
--
-- Two things the invitation form now asks, and they are asked for the same
-- reason: the first message back is written by a person, by hand.
--
-- `relationship` is what the asker is to the person the archive is for — a
-- daughter, a son, a carer. It is the difference between "Dear Madam" and
-- knowing you are writing to someone about their mother.
--
-- `preferred_language` is which of the three to write in. Recall sells in
-- Belgium and the reply is written by hand; guessing from an email address
-- is how a Walloon family gets a Dutch letter. The form prefills it from the
-- language the page is being read in, which is the best evidence there is.
--
-- Both optional and both nullable: an older client, or somebody who leaves
-- them blank, still gets their request recorded. Nothing here is a gate.
--
-- Backend twin:  backend/src/routes/onboarding.ts
-- Frontend twin: frontend/src/pages/onboarding/RequestInvitePage.tsx

alter table invitation_requests
  add column if not exists relationship text;

alter table invitation_requests
  add column if not exists preferred_language text
    check (preferred_language is null or preferred_language in ('fr', 'nl', 'en'));

comment on column invitation_requests.relationship is
  'What the asker is to the person the archive is for — daughter, son, '
  'carer (061). Free text, capped by the route. Optional.';

comment on column invitation_requests.preferred_language is
  'Which of the three languages to write back in (061), prefilled from the '
  'language the form was read in. Null means nobody said.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'the request remembers who they are' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitation_requests' and column_name = 'relationship'
       ) then 'OK' else 'MISSING' end as result
union all
select 'and which language to answer in',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitation_requests' and column_name = 'preferred_language'
       ) then 'OK' else 'MISSING' end
union all
select 'only the three languages are accepted',
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'invitation_requests'::regclass
           and pg_get_constraintdef(oid) like '%preferred_language%'
           and pg_get_constraintdef(oid) like '%''fr''%'
           and pg_get_constraintdef(oid) like '%''nl''%'
           and pg_get_constraintdef(oid) like '%''en''%'
       ) then 'OK' else 'MISSING' end
union all
select 'no existing request was disturbed',
       case when not exists (
         select 1 from invitation_requests
         where preferred_language is not null and preferred_language not in ('fr', 'nl', 'en')
       ) then 'OK' else 'MISSING' end;
