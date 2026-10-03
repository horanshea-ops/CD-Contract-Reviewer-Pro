-- 012 — Historical contracts upload in bulk, with their details read from the
-- contract rather than typed. Apply after 011.
--
-- An upload arrives with a file and nothing else, so every detail column is
-- nullable until the contract is read or an admin fills it in.

alter table historical_contracts alter column hotel_name drop not null;
alter table historical_contracts alter column brand drop not null;
alter table historical_contracts alter column city drop not null;
alter table historical_contracts alter column state drop not null;
alter table historical_contracts alter column country drop not null;
alter table historical_contracts alter column market_tier drop not null;
alter table historical_contracts alter column client_name drop not null;
alter table historical_contracts alter column signed_at drop not null;
alter table historical_contracts alter column state drop default;
alter table historical_contracts alter column country drop default;

-- The same file uploaded twice is stored once.
alter table historical_contracts add column file_sha256 text;
create unique index historical_contracts_file_sha256_idx on historical_contracts(file_sha256);

-- Which details were checked against the contract's words, guessed, or edited.
alter table historical_contracts add column details_checked jsonb;

-- The contract's text, read locally at upload at no cost. contract_text is what
-- the model reads for a Word file; contract_parts is what its quotes are
-- checked against, headers and footers included.
alter table historical_contracts add column contract_text text;
alter table historical_contracts add column contract_parts jsonb;

-- waiting: stored, not yet sent to be read. reading: in a batch.
alter table historical_contracts drop constraint historical_contracts_extraction_status_check;
alter table historical_contracts add constraint historical_contracts_extraction_status_check
  check (extraction_status in ('stored', 'waiting', 'reading', 'pending', 'done', 'failed', 'blocked_ai_clause'));

-- ---------------------------------------------------------------------------
-- historical_batches
-- One row per batch sent to Anthropic's Batch service.
-- ---------------------------------------------------------------------------
create table historical_batches (
  id uuid primary key default gen_random_uuid(),
  anthropic_batch_id text not null unique,
  sent_by uuid not null references associates(id),
  sent_at timestamptz not null default now(),
  contract_count integer not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'ended', 'failed')),
  ended_at timestamptz,
  usage jsonb
);

alter table historical_batches enable row level security;

alter table historical_contracts add column batch_id uuid references historical_batches(id);
