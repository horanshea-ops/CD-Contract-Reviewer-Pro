-- 005 — MASTER_PLAN.md §1.8.7: per-associate signature block for drafted emails.
--
-- No settings screen exists yet, so this is edited inline on the email-draft
-- panel itself and remembered from there. Tone setting (the part §1.8.7 calls
-- optional) is not built.

alter table associates add column signature_block text;
