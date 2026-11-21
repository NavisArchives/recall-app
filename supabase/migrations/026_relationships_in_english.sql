-- 026: The stored relationships speak English too.
--
-- M28. The product had two languages by design — a French display for
-- Margaret, an English workspace for her family — and that split is now
-- retired: everything is English. The strings in the code were the visible
-- half. These rows are the other half, typed into the contributor form
-- before the decision and shown on the shelf ever since.
--
-- Listed one by one rather than pattern-matched: it is a small table holding
-- real people, and a clever regular expression over somebody's family is a
-- worse idea than a dozen plain lines.

update people set relationship = 'Daughter'      where relationship = 'Fille';
update people set relationship = 'Son'           where relationship = 'Fils';
update people set relationship = 'Grandson'      where relationship = 'Petit-fils';
update people set relationship = 'Granddaughter' where relationship = 'Petite-fille';
update people set relationship = 'Friend'        where relationship in ('Amie', 'Ami');
update people set relationship = 'Herself'       where relationship = 'Elle-même';
update people set relationship = 'Himself'       where relationship = 'Lui-même';
update people set relationship = 'Wife'          where relationship = 'Épouse';
update people set relationship = 'Husband'       where relationship = 'Époux';
update people set relationship = 'Sister'        where relationship = 'Sœur';
update people set relationship = 'Brother'       where relationship = 'Frère';
update people set relationship = 'Neighbour'     where relationship = 'Voisin';
update people set relationship = 'Caregiver'     where relationship in ('Soignant', 'Soignante');

-- Same for the invitations still in flight, so an invitee is not greeted in
-- a language the rest of the product stopped speaking.
update invitations set relationship = 'Daughter'      where relationship = 'Fille';
update invitations set relationship = 'Son'           where relationship = 'Fils';
update invitations set relationship = 'Grandson'      where relationship = 'Petit-fils';
update invitations set relationship = 'Granddaughter' where relationship = 'Petite-fille';
update invitations set relationship = 'Friend'        where relationship in ('Amie', 'Ami');
update invitations set relationship = 'Caregiver'     where relationship in ('Soignant', 'Soignante');

-- The subject's own language preference is no longer read anywhere (M32
-- removed it from the API and the screens). The column stays; this only
-- stops it being the reason a new family sees French.
update settings set preferred_language = null where preferred_language = 'Français';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'no French relationship on a person' as check,
       case when not exists (
         select 1 from people
          where relationship in ('Fille','Fils','Petit-fils','Petite-fille','Amie','Ami',
                                 'Elle-même','Lui-même','Épouse','Époux','Sœur','Frère',
                                 'Voisin','Soignant','Soignante')
       ) then 'OK' else 'STILL FRENCH' end as result
union all
select 'no French relationship on an invitation',
       case when not exists (
         select 1 from invitations
          where relationship in ('Fille','Fils','Petit-fils','Petite-fille','Amie','Ami',
                                 'Soignant','Soignante')
       ) then 'OK' else 'STILL FRENCH' end
union all
select 'nobody lost their relationship in the process',
       (select count(*)::text from people where relationship is not null)
union all
select 'the relationships now on file',
       (select string_agg(distinct relationship, ', ') from people where relationship is not null);
