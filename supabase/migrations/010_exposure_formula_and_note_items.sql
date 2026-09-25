-- 010 — checked exposure figures, and document notes as short items.
--
-- exposure_formula is the model's arithmetic behind a finding's exposure
-- figure. The app evaluates it and stores the result as exposure_amount, so a
-- figure on screen is always one the app worked out. Findings from before this
-- column have no formula.
--
-- document_notes becomes a list of { headline, detail } items. Notes written
-- before this migration become a JSON string, which the review screen reads as
-- one block of legacy text.

alter table findings add column exposure_formula text;

alter table analyses
  alter column document_notes type jsonb
  using case when document_notes is null then null else to_jsonb(document_notes) end;
