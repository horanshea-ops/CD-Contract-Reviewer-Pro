-- 018 — Where a change belongs, by the associate's choice.
--
-- The review screen now checks each change against the Word file before the
-- associate decides. When a change has no place there, the associate gives it
-- one, and that choice is kept with their decision:
--
--   edited_quote   the contract wording they picked for the change, in place
--                  of the model's quote
--   quote_context  the wording just before it, which says which of several
--                  places is meant
--   by_email       true when the change goes to the property in the email and
--                  not in the redline
--
-- Apply before deploying the code that saves these. It is safe while older
-- code is live, which never reads or writes the three columns. Applying it
-- twice changes nothing.

alter table finding_actions add column if not exists edited_quote text;
alter table finding_actions add column if not exists quote_context text;
alter table finding_actions add column if not exists by_email boolean not null default false;
