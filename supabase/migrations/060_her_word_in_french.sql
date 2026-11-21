-- 060 — Her word, in French too (owner, 17 Sep 2026)
--
-- Recall is sold in Belgium and now speaks three languages. `archive_consents`
-- records which wording a person actually signed, and its check constraint
-- admitted only 'en' and 'nl' — so a French signer was recorded as having
-- signed the English declaration. For an ordinary string that is untidy; for
-- the one row that says a family had the right to put someone's life on a
-- screen, it is a wrong fact about a legal act.
--
-- The declaration itself has NOT changed, so `text_version` stays where it is.
-- A signature is identified by (text_version, lang) together: the same
-- declaration, rendered in a third language. No existing row is touched, and
-- no earlier wording is borrowed for a later signature.
--
-- Frontend twin: frontend/src/lib/consent.ts (CONSENT_COPY.fr)
-- Backend twin:  backend/src/services/consent.ts

alter table archive_consents
  drop constraint if exists archive_consents_lang_check;

alter table archive_consents
  add constraint archive_consents_lang_check
  check (lang in ('en', 'nl', 'fr'));

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'a French signature can be recorded' as check,
       case when exists (
         select 1 from pg_constraint
         where conname = 'archive_consents_lang_check'
           and pg_get_constraintdef(oid) like '%''fr''%'
       ) then 'OK' else 'MISSING' end as result
union all
select 'and Dutch and English still can',
       case when (
         select pg_get_constraintdef(oid) from pg_constraint
         where conname = 'archive_consents_lang_check'
       ) like '%''en''%' and (
         select pg_get_constraintdef(oid) from pg_constraint
         where conname = 'archive_consents_lang_check'
       ) like '%''nl''%'
       then 'OK' else 'MISSING' end
union all
select 'no consent row was disturbed',
       case when not exists (
         select 1 from archive_consents where lang not in ('en', 'nl', 'fr')
       ) then 'OK' else 'MISSING' end;
