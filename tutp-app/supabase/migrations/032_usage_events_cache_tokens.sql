-- TUT-10: prompt caching counts per model call. Both nullable, no default, so
-- every existing row and every insert that does not name them stays valid.
-- Not run on production by Claude: run it by hand, then set USAGE_CACHE_COLUMNS=1
-- on the Cloud Run service (until then the same numbers are in properties).
alter table usage_events add column if not exists cache_creation_input_tokens integer;
alter table usage_events add column if not exists cache_read_input_tokens integer;
