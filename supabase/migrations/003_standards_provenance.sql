-- 003 — record which standards library actually produced each analysis
--
-- The analysis pipeline now reads the `standards` table rather than the bundled
-- lib/standards/v1.ts array, so a senior associate editing the admin screen
-- changes how contracts are reviewed.
--
-- That creates a traceability gap. 001's comment states that library_version
-- exists "so a finding is always traceable to the exact library snapshot that
-- produced it (§6)" — but every standards row shares the version string
-- "v1-industry-default" (it is the seed script's upsert conflict key), so an
-- admin edit changes the library's content while leaving its version identical.
-- library_version alone therefore no longer identifies what the model saw.
--
-- These two columns close it: `standards_hash` fingerprints the exact entries
-- sent, and `standards_source` records whether they came from the database or
-- from the bundled fallback — build brief §14's failure mode is "the stage-1
-- library ships by accident", so that must never be silent.

alter table analyses add column standards_source text
  check (standards_source in ('database', 'bundled_fallback'));
alter table analyses add column standards_hash text;

-- Finding every analysis produced by one library revision is the main query
-- this supports: "which reviews used the attrition wording we just changed?"
create index analyses_standards_hash_idx on analyses(standards_hash);
