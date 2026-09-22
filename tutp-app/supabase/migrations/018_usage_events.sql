create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  family_id bigint references family_registrations(id) on delete cascade,
  student_id uuid references students(id) on delete set null,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_events_name_created on usage_events(event_name, created_at);
create index if not exists idx_usage_events_family on usage_events(family_id);
create index if not exists idx_usage_events_student on usage_events(student_id);
