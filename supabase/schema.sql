-- CD Contract Reviewer — initial schema
-- Implements the data model sketched in the build brief §6. Run this once
-- against a fresh Supabase project (SQL Editor, or `supabase db push`).
--
-- Notes:
--   - All server-side access goes through the service role key (non-negotiable
--     #2/#5: the app is a thin server, not a client talking directly to the
--     database) — service_role always bypasses RLS. Row Level Security is
--     enabled on every table below with zero policies, which makes the
--     anon/publishable key (shipped to the browser for Supabase Auth) unable
--     to read or write anything here by default. Add policies later only if
--     a browser client needs to query one of these tables directly.
--   - library_version on analyses and standards.version exist so a finding is
--     always traceable to the exact library snapshot that produced it (§6).
--   - provenance on standards is load-bearing: nothing should reach an
--     associate looking like CD's real position when it's actually a generic
--     default (§6, §14 "the stage-1 library ships by accident").

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- associates
-- Doubles as the auth allowlist (§4.2): only rows with status = 'active' can
-- sign in via magic link. No password — Supabase Auth handles the link.
-- ---------------------------------------------------------------------------
create table associates (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  segment text, -- association / corporate / citywide / single-property / itfty
  status text not null default 'active' check (status in ('active', 'revoked')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- clients
-- CD's customer, for filtering and audit — not a CRM, just a label.
-- ---------------------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- analyses
-- One row per uploaded contract review.
-- ---------------------------------------------------------------------------
create table analyses (
  id uuid primary key default gen_random_uuid(),
  associate_id uuid not null references associates(id),
  client_id uuid references clients(id),
  filename text not null,
  storage_path text not null,
  page_count integer,
  model_id text,
  library_version text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'complete', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  token_usage jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index analyses_associate_id_idx on analyses(associate_id);
create index analyses_client_id_idx on analyses(client_id);
create index analyses_status_idx on analyses(status);

-- ---------------------------------------------------------------------------
-- findings
-- One row per issue (or missing clause) surfaced by an analysis.
-- ---------------------------------------------------------------------------
create table findings (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  clause_type text not null,
  is_missing_clause boolean not null default false,
  severity text not null check (severity in ('high', 'medium', 'low', 'note')),
  exposure_amount numeric,
  exposure_basis text,
  location_page integer,
  location_section text,
  quoted_text text,
  char_start integer,
  char_end integer,
  finding_text text not null,
  cd_standard text not null,
  proposed_language text not null,
  model_confidence text check (model_confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now()
);

create index findings_analysis_id_idx on findings(analysis_id);
create index findings_clause_type_idx on findings(clause_type);

-- ---------------------------------------------------------------------------
-- finding_actions
-- The product's memory (§6): every accept/edit/dismiss, with the reason.
-- ---------------------------------------------------------------------------
create table finding_actions (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  associate_id uuid not null references associates(id),
  action text not null check (action in ('accept', 'edit', 'dismiss')),
  edited_language text,
  dismissal_reason text,
  created_at timestamptz not null default now()
);

create index finding_actions_finding_id_idx on finding_actions(finding_id);
create index finding_actions_associate_id_idx on finding_actions(associate_id);

-- ---------------------------------------------------------------------------
-- standards
-- The library itself (§7). One row per clause_type + segment combination.
-- ---------------------------------------------------------------------------
create table standards (
  id uuid primary key default gen_random_uuid(),
  clause_type text not null,
  segment text not null default 'default',
  position text not null,
  fallback_language text not null,
  walk_away_condition text not null default '',
  severity_default text not null check (severity_default in ('high', 'medium', 'low', 'note')),
  version text not null,
  provenance text not null check (provenance in ('industry_default', 'extracted', 'cd_validated')),
  validated_by uuid references associates(id),
  validated_at timestamptz,
  updated_by uuid references associates(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (clause_type, segment, version)
);

create index standards_clause_type_idx on standards(clause_type);
create index standards_provenance_idx on standards(provenance);

-- ---------------------------------------------------------------------------
-- audit_log
-- The compliance record (§2 non-negotiable #4). Every action, not just
-- analysis runs — logins, admin edits to the library, exports, etc.
-- ---------------------------------------------------------------------------
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references associates(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata_json jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log(entity_type, entity_id);
create index audit_log_actor_id_idx on audit_log(actor_id);
create index audit_log_created_at_idx on audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security — enable on every table, no policies yet.
-- This denies all access via the public anon/publishable key by default.
-- Only the server-side service_role key (used by our Next.js backend) can
-- read or write these tables, since service_role always bypasses RLS.
-- ---------------------------------------------------------------------------
alter table associates enable row level security;
alter table clients enable row level security;
alter table analyses enable row level security;
alter table findings enable row level security;
alter table finding_actions enable row level security;
alter table standards enable row level security;
alter table audit_log enable row level security;
