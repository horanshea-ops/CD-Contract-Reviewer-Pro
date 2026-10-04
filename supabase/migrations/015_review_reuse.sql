-- 015 — Re-using a review when the same file is uploaded again.
--
-- A new upload copies an earlier review by the same associate when the model
-- would be sent the same content, under the same standards library, model and
-- prompt. The copy calls no model, so it costs nothing and uses no allowance.
--
--   content_hash  what the review call would send as the contract
--   prompt_hash   the review's model, instructions and answer form
--   review_kind   how the findings came to be: a full review, a copy of one,
--                 or a comparison with the round before (MASTER_PLAN §2.1.2)
--
-- standards_hash (migration 003) is the third thing a match needs.
--
-- Reviews made before this migration carry no hashes, so none can be copied.

alter table analyses add column content_hash text;
alter table analyses add column prompt_hash text;
alter table analyses
  add column review_kind text not null default 'full'
  check (review_kind in ('full', 'copied', 'compared'));
alter table analyses
  add column copied_from_analysis_id uuid references analyses(id) on delete set null;

create index analyses_reuse_idx on analyses(associate_id, content_hash)
  where content_hash is not null;
