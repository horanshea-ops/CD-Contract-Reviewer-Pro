@AGENTS.md

## Model and effort protocol

`MASTER_PLAN.md` §0.1 assigns a model and effort level to every work item.

At the start of every work item, before writing any code:
1. State which section of the plan you are working on.
2. State the model and effort level that section requires.
3. State which model you are currently running.
4. If they do not match, STOP. Tell me to switch, and wait. Do not proceed.

Override the table **upward, never downward**. Running Opus 5 on a section
assigned Sonnet 5 is fine; the reverse is not.

Never begin work on §1.4, §1.5, §1.6, §2.0, §2.1 or §2.3 — or on anything touching
authentication, row-level security, key handling, or financial calculation — while
running Sonnet. Those require Opus 5.

If you have attempted the same failing test three times on a §1.4 or §1.5 task at
xhigh effort, stop and say so rather than trying a fourth approach. Repeated failure
there usually means the approach is wrong, not that the implementation needs another
pass.

Before starting any section, use plan mode and get the plan approved.

## Branch and commit protocol

Work happens on a branch named for the plan section (`phase/1-5-revision-engine`),
never directly on `main`. At the start of a work item, state which branch you are on.
If it is `main`, stop and create the correct branch first.

Commit at every working state, not at every finished feature. A working state is any
point where the test suite passes, however incomplete the feature is. Write commit
messages describing what changed, not what section you are on.

Never commit `.env`, any file containing a key, or any contract document. If you are
about to stage a file matching those, stop and tell me.

Before merging to `main`, confirm the section's tests pass and say which ones you ran.

## Checks

`npm run lint`, `npm run typecheck`, and `npm test` all run in CI on every push
(`.github/workflows/ci.yml`). Keep them green — a red baseline trains everyone to
ignore CI. CI deliberately does not run `next build`, which needs live Supabase
credentials.

Schema changes are numbered files in `supabase/migrations/`, applied in order and
never edited once committed.

## Agreed deviations from MASTER_PLAN.md

Decided 2026-09-07, before Part 1 started. The plan text is unchanged; these
override it.

1. **§1.7's LibreOffice conversion worker is dropped.** No container, no new
   vendor, no monthly cost. The export fallback reuses `lib/redline-pdf.ts`;
   legacy `.doc` keeps `word-extractor`. §1.6.3's optional LibreOffice deep check
   is dropped with it — the §1.6.2 reject-all round trip is the real oracle.
2. **New §1.4a: HTML preview.** The DOCX preview is rendered as a web page from
   §1.4's source map, not converted to PDF. This is the fix for ROADMAP.md's
   "DOCX-to-preview" priority, which is closed and folded in. It replaces
   `line-positions.json`, the `text-to-pdf` reflow, and coordinate matching for
   DOCX-sourced analyses. Genuine PDF uploads keep the existing pdfjs viewer.
3. **Phase 0 exists** and precedes §1.3: test runner, CI, migrations.
4. **Part 1 is a rewrite, not a greenfield build.** `lib/tracked-changes-docx.ts`
   already does `w:ins`/`w:del`. It stays switched on until the §1.5 engine passes
   all 12 fixtures.
5. **The "everything must be a PDF" constraint is dropped** (confirmed by the user,
   2026-09-07). It appeared in one code comment citing a build-brief clause not in
   the repo. Uploads still accept DOCX, PDF and DOC; what changes is that the model
   receives extracted structured text for DOCX rather than a converted PDF, which is
   what §1.4.5 requires so tables reach it as tables.
