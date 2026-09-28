-- 027: a free-text note on payments, so rows that aren't real revenue can be
-- marked. Rows with note = 'TEST' (e.g. the far-future, amount-0 period that
-- keeps the e2e test family 16 paid) still grant access like any captured
-- payment, but the Founder Dashboard leaves them out of revenue, active paid
-- users, per-tier counts and the 14-day chart (server.js, /api/admin/*).
--
-- Already applied by hand in the SQL editor on 2026-09-27, together with the
-- family 16 TEST row; kept here so every copy of the schema matches.
alter table payments add column if not exists note text;
