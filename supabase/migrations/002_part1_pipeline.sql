-- 002 — Part 1: DOCX revision pipeline
-- Implements MASTER_PLAN.md §1.2, plus the intake-routing columns from §1.4.9.
--
-- Deviations from the plan's SQL, all deliberate:
--   - `analyses.source_format` is NOT added here; it already exists (001).
--   - Primary keys get `default gen_random_uuid()`, foreign keys get real
--     references, and enum-ish columns get check constraints — matching the
--     conventions in 001 rather than the plan's shorthand.
--   - RLS is enabled on every new table with zero policies, exactly as in 001.
--     Server-side service_role access only; the browser's anon key can read
--     nothing. Adding a policy would be the first in this codebase and should
--     be a conscious decision, not a side effect of adding a table.

-- ---------------------------------------------------------------------------
-- negotiation_threads
-- One negotiation, spanning many rounds (§1.9). Created before the analyses
-- columns below, which reference it.
-- ---------------------------------------------------------------------------
create table negotiation_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  property_name text,
  event_start date,
  event_end date,
  associate_id uuid not null references associates(id),
  status text not null default 'open' check (status in ('open', 'signed', 'dead')),
  created_at timestamptz not null default now()
);

create index negotiation_threads_associate_id_idx on negotiation_threads(associate_id);
create index negotiation_threads_client_id_idx on negotiation_threads(client_id);

-- ---------------------------------------------------------------------------
-- analyses — existing-revision detection (§1.4.2), the AI-use gate (§1.10),
-- intake routing (§1.4.9), and round linkage (§1.9.2).
-- ---------------------------------------------------------------------------
alter table analyses add column had_existing_revisions boolean;
alter table analyses add column existing_revision_authors jsonb;
alter table analyses add column existing_revision_count integer;

-- The compliance artifact for §1.10.4: a human saw the clause and made a call.
alter table analyses add column ai_clause_scan_result jsonb;
alter table analyses add column ai_clause_acknowledged_by uuid references associates(id);
alter table analyses add column ai_clause_acknowledged_at timestamptz;

-- §1.4.9: decided at intake, before analysis — not at export.
alter table analyses add column intake_route text
  check (intake_route in ('docx_native', 'pdf'));
alter table analyses add column intake_health jsonb; -- per-check results

-- §1.9: retrofitting negotiation history is impossible, so these land now even
-- though the diff engine (§2.1) is gated behind the accuracy gate.
alter table analyses add column thread_id uuid references negotiation_threads(id);
alter table analyses add column round_number integer not null default 1;
alter table analyses add column parent_analysis_id uuid references analyses(id);

create index analyses_thread_id_idx on analyses(thread_id);

-- ---------------------------------------------------------------------------
-- findings — how confidently a span was located (§1.5.1) and whether it could
-- legally be edited at all (§1.5.3).
-- ---------------------------------------------------------------------------
alter table findings add column span_resolution text
  check (span_resolution in ('exact', 'normalized', 'fuzzy', 'unresolved'));
alter table findings add column applicability text
  check (applicability in (
    'applicable',
    'blocked_table',
    'blocked_content_control',
    'blocked_field',
    'blocked_cross_paragraph',
    'blocked_already_deleted'
  ));
alter table findings add column applicability_detail text;

-- ---------------------------------------------------------------------------
-- exports
-- §1.2: "outcome and fallback_reason are the dataset that tells you which
-- document constructs break the engine. Instrument from day one." This is what
-- §1.6.6's degradation rate is computed from.
-- ---------------------------------------------------------------------------
create table exports (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  associate_id uuid not null references associates(id),
  format text not null check (format in ('docx', 'pdf', 'memo')),
  outcome text not null check (outcome in ('clean', 'partial', 'fallback')),
  fallback_reason text,
  findings_applied integer,
  findings_unapplied integer,
  unapplied_detail jsonb,
  storage_path text,
  created_at timestamptz not null default now()
);

create index exports_analysis_id_idx on exports(analysis_id);
create index exports_outcome_idx on exports(outcome);

-- ---------------------------------------------------------------------------
-- email_drafts
-- §1.8. Drafts only — nothing is ever sent from the tool (standing constraint).
-- ---------------------------------------------------------------------------
create table email_drafts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  associate_id uuid not null references associates(id),
  audience text not null check (audience in ('client', 'property')),
  subject text,
  body text,
  edited_by_associate boolean not null default false,
  created_at timestamptz not null default now()
);

create index email_drafts_analysis_id_idx on email_drafts(analysis_id);

-- ---------------------------------------------------------------------------
-- finding_outcomes
-- What the counterparty did with each finding, observed in a later round.
-- Populated by the diff engine (§2.1); the table exists now so data can start
-- accumulating from the first pilot contract.
-- ---------------------------------------------------------------------------
create table finding_outcomes (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references findings(id) on delete cascade,
  observed_in_analysis_id uuid not null references analyses(id) on delete cascade,
  outcome text check (outcome in (
    'accepted',
    'partially_accepted',
    'countered',
    'rejected',
    'unchanged',
    'undetermined'
  )),
  counter_language text,
  notes text,
  created_at timestamptz not null default now()
);

create index finding_outcomes_finding_id_idx on finding_outcomes(finding_id);
create index finding_outcomes_observed_in_idx on finding_outcomes(observed_in_analysis_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — same posture as 001: enabled, no policies.
-- ---------------------------------------------------------------------------
alter table negotiation_threads enable row level security;
alter table exports enable row level security;
alter table email_drafts enable row level security;
alter table finding_outcomes enable row level security;
