-- 011 — Standards library editing and historical contract uploads.
--
-- Additive only. Code already live ignores every column and table here, so this
-- is safe to apply before the code that uses it is deployed. That code must not
-- be deployed before this is applied: the standards loader reads retired_at.

-- ---------------------------------------------------------------------------
-- Removing a standard retires it. The row stays, so a review that quoted it
-- keeps its history, and an admin can restore it.
-- ---------------------------------------------------------------------------
alter table standards add column retired_at timestamptz;
alter table standards add column retired_by uuid references associates(id);

-- ---------------------------------------------------------------------------
-- historical_contracts
-- Signed contracts from before the tool, uploaded by an admin to feed the
-- Analytics tab. The admin enters the property and deal details; the model
-- reads only the terms, and only while HISTORICAL_EXTRACTION=on.
-- ---------------------------------------------------------------------------
create table historical_contracts (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references associates(id),
  file_name text not null,
  storage_path text not null,
  source_format text not null check (source_format in ('pdf', 'docx', 'doc')),
  hotel_name text not null,
  brand text not null,
  parent_company text,
  city text not null,
  state text not null default '',
  country text not null default 'United States',
  market_tier text not null check (market_tier in ('luxury', 'upper_upscale', 'upscale', 'resort', 'convention')),
  client_name text not null,
  negotiated_by uuid references associates(id),
  event_start date,
  event_end date,
  signed_at date not null,
  extraction_status text not null default 'stored'
    check (extraction_status in ('stored', 'pending', 'done', 'failed', 'blocked_ai_clause')),
  term_extraction jsonb,
  created_at timestamptz not null default now()
);

create index historical_contracts_signed_at_idx on historical_contracts(signed_at);

alter table historical_contracts enable row level security;

-- ---------------------------------------------------------------------------
-- A term row belongs to a review or to a historical contract, never both.
-- ---------------------------------------------------------------------------
alter table contract_terms alter column analysis_id drop not null;
alter table contract_terms
  add column historical_contract_id uuid references historical_contracts(id) on delete cascade;
alter table contract_terms
  add constraint contract_terms_one_source check ((analysis_id is null) <> (historical_contract_id is null));

create index contract_terms_historical_contract_id_idx on contract_terms(historical_contract_id);
