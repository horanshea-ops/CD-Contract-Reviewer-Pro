-- 006 — MASTER_PLAN.md §2.0.2: structured term extraction.
--
-- One row per catalog term per analysis, stated or not, so "this contract has
-- no cutoff date" is a query rather than an absence. Downstream features
-- compute only from rows whose verification is 'verified' or 'located'
-- (lib/terms/types.ts); 'contradicted' and 'unlocated' rows are kept so an
-- associate can see them, never so a number can be built on them.
--
-- Written only when TERM_EXTRACTION=on. While the switch is off nothing reads
-- or writes these, so applying this migration changes no behaviour by itself.

create table contract_terms (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references analyses(id) on delete cascade,
  term_key text not null,
  status text not null check (status in ('stated', 'not_stated')),
  term_value jsonb,
  unit text check (unit in ('pct', 'usd', 'days', 'months', 'hours', 'rooms')),
  source_section text,
  quoted_text text,
  verification text check (verification in ('verified', 'located', 'contradicted', 'unlocated')),
  confidence text check (confidence in ('high', 'medium', 'low')),
  catalog_version text not null,
  extracted_at timestamptz not null default now(),
  check ((status = 'stated') = (term_value is not null)),
  check ((status = 'stated') = (verification is not null))
);

create index contract_terms_analysis_id_idx on contract_terms(analysis_id);
create index contract_terms_term_key_idx on contract_terms(term_key);

-- Same as every other table: no policies, so only the server's service role
-- can read or write it.
alter table contract_terms enable row level security;

-- Status, model, catalog version, token usage, rejections and conflicts for
-- the pass, whether it worked or not.
alter table analyses add column term_extraction jsonb;
