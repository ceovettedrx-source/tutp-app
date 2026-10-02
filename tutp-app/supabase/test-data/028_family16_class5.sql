-- Test data only, not a migration (founder decision 3, 2026-09-30): the
-- e2e test family 16's child is Class 5 in Telangana, so the exam prep e2e
-- (tests/e2e/exam-prep.spec.js) can open the pilot chapter. The same child
-- as the TEST payment row. Run once in the Supabase SQL editor after
-- migrations/028_answer_cache.sql. Safe to run twice.
update students set class = 'Class 5', state = 'Telangana'
where id = 'cdfb427e-d579-44a9-b7d2-a01cbee207eb' and family_id = 16;

-- The pilot only serves state boards, and it reads the board from the
-- family's registration (data.children[].curriculum). Family 16's child is
-- registered with another board, so the pilot answers "board". Set it to a
-- state board for that one child of family 16 only.
update family_registrations
set data = jsonb_set(
  data,
  '{children}',
  (
    select jsonb_agg(
      case
        when lower(trim(c->>'name')) = (
          select lower(trim(name)) from students where id = 'cdfb427e-d579-44a9-b7d2-a01cbee207eb'
        )
        then jsonb_set(c, '{curriculum}', '"State Board (Telangana)"')
        else c
      end
    )
    from jsonb_array_elements(data->'children') c
  )
)
where id = 16 and jsonb_typeof(data->'children') = 'array';
