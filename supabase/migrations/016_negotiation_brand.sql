-- 016 — The hotel's brand on a negotiation.
--
-- The upload screen reads a contract's brand and the associate confirms it.
-- The brand is the hotel's actual one, whether or not CD has standards
-- specific to it. `standards_set` (migration 015) still says which standards
-- the negotiation's reviews read, and is worked out from this brand.
--
-- Apply before deploying the code that writes this column.

alter table negotiation_threads add column brand text;
