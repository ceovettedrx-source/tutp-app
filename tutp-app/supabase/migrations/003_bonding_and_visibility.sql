-- Run in the Supabase SQL editor, same as 001/002.
-- family_id is bigint, matching family_registrations.id (confirmed there).

-- One row per "viewer" per family. viewer_key is 'mother', 'father', or a
-- family_members.id (uuid, stored as text) — this lets mother/father (who
-- have no row of their own anywhere, just fields inside
-- family_registrations.data) and extended family members (who do have a
-- family_members row) share one table without a nullable/polymorphic FK.
create table if not exists bonding_scores (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  viewer_key text not null,
  score int not null default 0 check (score between 0 and 100),
  updated_at timestamptz not null default now(),
  unique (family_id, viewer_key)
);

create index if not exists idx_bonding_scores_family_id on bonding_scores(family_id);

-- Per-member dashboard feature visibility, set by mother/father in the
-- "Manage Family" settings screen. Only extended family members can be
-- restricted — mother/father are always full-access, so this only ever
-- references family_members, not a viewer_key. Absence of a row means
-- "visible" (parents only insert rows to hide something).
create table if not exists member_visibility_rules (
  id uuid primary key default gen_random_uuid(),
  family_id bigint not null references family_registrations(id) on delete cascade,
  family_member_id uuid not null references family_members(id) on delete cascade,
  feature_name text not null check (feature_name in ('bonding_report', 'homework', 'activities')),
  is_visible boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (family_id, family_member_id, feature_name)
);

create index if not exists idx_member_visibility_rules_family_id on member_visibility_rules(family_id);
create index if not exists idx_member_visibility_rules_member_id on member_visibility_rules(family_member_id);
