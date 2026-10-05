-- READ ONLY. Run in the Supabase SQL editor before and after making the bucket
-- private (scripts/storage/make-private.ps1). For every text / varchar / json /
-- jsonb / array column of every table in schema public it counts the rows that
-- still hold a public link into the family-uploads bucket, and shows only the
-- columns where that count is above zero. The last row is the number of objects
-- in the bucket (not a column). Nothing is changed and no value is printed,
-- only table, column and a count.
with cols as (
  select c.table_schema, c.table_name, c.column_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public'
    and c.data_type in ('text', 'character varying', 'json', 'jsonb', 'ARRAY')
), counts as (
  select table_name, column_name,
    (xpath('/row/n/text()', query_to_xml(
      format('select count(*) as n from %I.%I where %I::text like %L',
             table_schema, table_name, column_name, '%/storage/v1/object/public/family-uploads/%'),
      false, true, '')))[1]::text::bigint as n
  from cols
)
select table_name::text, column_name::text, n from counts where n > 0
union all
select 'storage.objects (bucket family-uploads)', 'objects in the bucket, not a column', count(*) from storage.objects where bucket_id = 'family-uploads'
order by 3 desc;
