-- 014 — Short "why" comments in the Word redline (CLAUDE.md deviation 8).
--
-- The model writes a one-sentence note on each business finding. It becomes a
-- Word comment on that change, which the property reads, so the app checks
-- the note's words before storing it and again before export. The associate
-- can edit or clear it on the card.
--
-- Apply before deploying the code that writes these columns.

alter table findings add column redline_note text not null default '';

-- The associate's version. Null means use the model's; empty means no comment.
alter table findings add column edited_redline_note text;

-- Legal findings never reach the redline, so they carry no note.
alter table findings add constraint findings_legal_has_no_note
  check (category <> 'legal' or (redline_note = '' and coalesce(edited_redline_note, '') = ''));
