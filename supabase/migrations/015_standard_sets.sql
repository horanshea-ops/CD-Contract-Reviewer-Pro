-- 015 — Standards sets by hotel brand (CLAUDE.md deviation 10).
--
-- CD has pre-negotiated standard contracts with some hotel brands, so a review
-- compares a contract with the standards for its brand. A set is one complete
-- library. Independent is the catch-all and holds every standard that existed
-- before this migration.
--
-- Apply before deploying the code that reads these columns. It is safe to
-- apply while older code is live: that code ignores the new table and columns.
-- Add no Hilton or Hyatt standard until the new code is live, because the
-- older loader reads every row whatever its set.

create table standard_sets (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  name text not null,

  -- Brand names, as a contract writes them, that mean this set.
  brand_names text[] not null default '{}',

  -- The set a review uses when its brand has none, or its set is switched off.
  is_default boolean not null default false,

  -- A set is used for reviews only once an admin switches it on. A half-built
  -- set would otherwise review a contract against a handful of standards.
  is_active boolean not null default false,

  source_document text not null default '',
  source_date date,
  updated_by uuid references associates(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint standard_sets_default_is_active check (not is_default or is_active)
);

create unique index standard_sets_one_default on standard_sets (is_default) where is_default;

alter table standard_sets enable row level security;

insert into standard_sets (key, name, brand_names, is_default, is_active) values
  ('independent', 'Independent', '{}', true, true),
  ('hilton', 'Hilton', '{Hilton}', false, false),
  ('hyatt', 'Hyatt', '{Hyatt}', false, false);

-- ---------------------------------------------------------------------------
-- standards: every existing row becomes Independent's.
-- ---------------------------------------------------------------------------
alter table standards add column set_key text not null default 'independent' references standard_sets(key);
create index standards_set_key_idx on standards(set_key);

-- One standard per clause becomes one per clause per set. The old constraint
-- is found by its columns, since its name was generated.
do $$
declare
  old_name text;
begin
  select c.conname into old_name
  from pg_constraint c
  where c.conrelid = 'standards'::regclass
    and c.contype = 'u'
    and (
      select array_agg(a.attname::text order by a.attname::text)
      from pg_attribute a
      where a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    ) = array['clause_type', 'segment', 'version'];

  if old_name is not null then
    execute format('alter table standards drop constraint %I', old_name);
  end if;
end $$;

alter table standards add constraint standards_set_clause_segment_version_key
  unique (set_key, clause_type, segment, version);

-- ---------------------------------------------------------------------------
-- Which set a negotiation asks for, and which a review used.
-- ---------------------------------------------------------------------------

-- Null means the default set. Every round of a negotiation reads this.
alter table negotiation_threads add column standards_set text references standard_sets(key);

-- The set whose standards the review read. Null on reviews from before sets.
alter table analyses add column standards_set text references standard_sets(key);

-- Set only when the review could not use the set its negotiation asked for.
alter table analyses add column standards_set_requested text;
alter table analyses add column standards_set_note text;
