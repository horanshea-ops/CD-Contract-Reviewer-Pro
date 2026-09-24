-- 009 — the model's notes on the document as a whole.
--
-- The review returns these alongside its findings: places the contract
-- contradicts itself, a missing exhibit, a clause that reads unusually. The
-- review screen shows them above the findings. Analyses from before this
-- column exist without notes.
--
-- CD's internal reading of the contract, like finding_text: it must never
-- reach the property email.

alter table analyses add column document_notes text;
