-- 013 — Business, legal and other categories, and compromise ranges.
--
-- CD gives no legal advice. A legal standard's findings are explained to the
-- associate and never carry contract wording, and the database refuses legal
-- wording outright. Severity stays as the priority within each category.
--
-- The compromise range is CD's fallback position on a business standard. Only
-- the associate sees it, on the review card.
--
-- Apply before deploying the code that reads these columns.

-- ---------------------------------------------------------------------------
-- standards
-- ---------------------------------------------------------------------------
alter table standards add column category text not null default 'business'
  check (category in ('business', 'legal', 'other'));
alter table standards add column compromise_range text not null default '';

update standards set category = 'legal'
where clause_type in (
  'insurance_indemnification',
  'hotel_cancellation',
  'force_majeure',
  'governing_law_venue',
  'ada_compliance',
  'nondiscrimination',
  'attendee_data_handling',
  'assignment_subcontracting'
);

-- "Other" was a severity. It is now a category, so a library row on it moves.
update standards set category = 'other', severity_default = 'low' where severity_default = 'note';

alter table standards drop constraint standards_severity_default_check;
alter table standards add constraint standards_severity_default_check
  check (severity_default in ('high', 'medium', 'low'));

-- ---------------------------------------------------------------------------
-- findings
-- Both columns are snapshots taken when the review runs, as severity is.
-- ---------------------------------------------------------------------------
alter table findings add column category text not null default 'business'
  check (category in ('business', 'legal', 'other'));
alter table findings add column compromise_range text not null default '';

update findings set category = 'other' where clause_type = 'general';

update findings set category = 'legal', proposed_language = ''
where clause_type in (
  'insurance_indemnification',
  'hotel_cancellation',
  'force_majeure',
  'governing_law_venue',
  'ada_compliance',
  'nondiscrimination',
  'attendee_data_handling',
  'assignment_subcontracting'
);

alter table findings add constraint findings_legal_has_no_wording
  check (category <> 'legal' or proposed_language = '');
