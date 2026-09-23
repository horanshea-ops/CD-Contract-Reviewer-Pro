-- 007 — a one-line headline per finding, written by the model.
--
-- The review screen leads each finding card with it. Findings from before this
-- column exist without one, and the card falls back to finding_text.
--
-- CD's reasoning, like finding_text: it must never reach the property email.

alter table findings add column headline text;
