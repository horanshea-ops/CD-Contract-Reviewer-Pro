-- 004 — MASTER_PLAN.md §1.9: multi-round negotiation hooks
--
-- negotiation_threads and analyses.thread_id/round_number/parent_analysis_id
-- already exist (002) but are unused by any code so far. This migration adds
-- the one column that's actually new: a place to store each round's accepted-
-- view text, which the future diff engine (§2.1) will need and which is cheap
-- to capture now but impossible to reconstruct retroactively later.

alter table analyses add column accepted_view_text text;
