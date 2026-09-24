-- 008 — a redline skip reason for proposed wording that needs editing first.
--
-- The redline leaves a change out when its wording still has a blank such as
-- "[X]", reads as an instruction, or ends a sentence the contract carries on.
-- applicability_detail says which.
--
-- 002 created the check inline, so it carries Postgres's default name.

alter table findings drop constraint findings_applicability_check;

alter table findings add constraint findings_applicability_check
  check (applicability in (
    'applicable',
    'blocked_table',
    'blocked_content_control',
    'blocked_field',
    'blocked_cross_paragraph',
    'blocked_already_deleted',
    'blocked_wording'
  ));
