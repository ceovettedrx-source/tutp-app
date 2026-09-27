-- 026: one stored format for family phone numbers: "+91" + the last 10 digits.
--
-- Why: login finds a family by searching for the 10 digits as one unbroken
-- run (findFamilyIdByPhone in server.js), so a number saved with spaces or
-- dashes ("+91 99999 00003") was never found and that person saw "You're new
-- here". From now on the server stores every phone through normalizePhone();
-- this brings the existing rows into the same format.
--
-- Touches: family_registrations.data->mother->phone, ->father->phone and
-- family_members.phone. Only values with at least 10 digits that aren't
-- already "+91" + 10 digits are rewritten; blank and shorter values are left
-- as they are (counted in too_short). The last 10 digits never change, so
-- nobody's login identity changes.
--
-- Output: one row "before" and one row "after" with the count of values not
-- yet in the stored format. "after" should be 0 in the first three columns.

create temp table _phone_counts (
  stage text,
  mother_unnormalized int,
  father_unnormalized int,
  member_unnormalized int,
  too_short int
);

insert into _phone_counts
select 'before',
  (select count(*) from public.family_registrations
    where length(regexp_replace(coalesce(data->'mother'->>'phone', ''), '\D', '', 'g')) >= 10
      and data->'mother'->>'phone' !~ '^\+91[0-9]{10}$'),
  (select count(*) from public.family_registrations
    where length(regexp_replace(coalesce(data->'father'->>'phone', ''), '\D', '', 'g')) >= 10
      and data->'father'->>'phone' !~ '^\+91[0-9]{10}$'),
  (select count(*) from public.family_members
    where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
      and phone !~ '^\+91[0-9]{10}$'),
  (select count(*) from (
      select data->'mother'->>'phone' as p from public.family_registrations
      union all select data->'father'->>'phone' from public.family_registrations
      union all select phone from public.family_members) v
    where trim(coalesce(p, '')) <> ''
      and length(regexp_replace(p, '\D', '', 'g')) < 10);

update public.family_registrations
set data = jsonb_set(data, '{mother,phone}',
      to_jsonb('+91' || right(regexp_replace(data->'mother'->>'phone', '\D', '', 'g'), 10)))
where length(regexp_replace(coalesce(data->'mother'->>'phone', ''), '\D', '', 'g')) >= 10
  and data->'mother'->>'phone' !~ '^\+91[0-9]{10}$';

update public.family_registrations
set data = jsonb_set(data, '{father,phone}',
      to_jsonb('+91' || right(regexp_replace(data->'father'->>'phone', '\D', '', 'g'), 10)))
where length(regexp_replace(coalesce(data->'father'->>'phone', ''), '\D', '', 'g')) >= 10
  and data->'father'->>'phone' !~ '^\+91[0-9]{10}$';

update public.family_members
set phone = '+91' || right(regexp_replace(phone, '\D', '', 'g'), 10)
where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
  and phone !~ '^\+91[0-9]{10}$';

insert into _phone_counts
select 'after',
  (select count(*) from public.family_registrations
    where length(regexp_replace(coalesce(data->'mother'->>'phone', ''), '\D', '', 'g')) >= 10
      and data->'mother'->>'phone' !~ '^\+91[0-9]{10}$'),
  (select count(*) from public.family_registrations
    where length(regexp_replace(coalesce(data->'father'->>'phone', ''), '\D', '', 'g')) >= 10
      and data->'father'->>'phone' !~ '^\+91[0-9]{10}$'),
  (select count(*) from public.family_members
    where length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) >= 10
      and phone !~ '^\+91[0-9]{10}$'),
  (select count(*) from (
      select data->'mother'->>'phone' as p from public.family_registrations
      union all select data->'father'->>'phone' from public.family_registrations
      union all select phone from public.family_members) v
    where trim(coalesce(p, '')) <> ''
      and length(regexp_replace(p, '\D', '', 'g')) < 10);

select * from _phone_counts order by stage desc;
