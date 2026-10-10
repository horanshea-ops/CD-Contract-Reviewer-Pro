# Roadmap / open items

Tracks decisions and follow-ups that are noted but deliberately not acted on yet,
per the build brief's phasing. See the build brief §11 for the authoritative build
order — the checklist below just tracks progress against it.

**As of 2026-09-07, `MASTER_PLAN.md` governs the current work package** (Part 1,
the DOCX revision pipeline). `CLAUDE.md` records the agreed deviations from
it — chiefly that §1.7's LibreOffice worker is dropped in favour of a new §1.4a
HTML preview. This file remains the living progress log.

**Part 1 is complete as of 2026-09-09** (§1.11's corpus aside, which grew
alongside the rest). Part 2 is gated — see "What the gate actually blocks" under
Open items, which separates the claims the gate must stop from the development it
need not.

- [x] **Phase 0 — groundwork (2026-09-07).** Vitest + `npm test`, `npm run
      typecheck`, GitHub Actions CI, and `supabase/migrations/`. Also fixed
      `pdf-lib` sitting in `devDependencies` while three runtime modules import
      it — a production install would have failed. Migration `002` is written
      but **not yet applied to the live database**.
      *Update 2026-09-07: migrations 002 and 003 applied and verified. CI was
      failing on every run — Next 16 generates route types into the gitignored
      .next folder, so tsc passed locally and failed on a fresh checkout;
      `next typegen` now runs as part of `npm run typecheck`.*

- [x] **§1.3 Library evaluation (2026-09-07).** Decision: **hand-roll the
      revision engine**, no third-party redlining library. `docx-redline-js`
      does not exist on npm. `docXMLater` preserves existing revisions, tables
      and formatting on a round trip, but when the text being changed sits
      inside the counterparty's own insertion it rewrites that text in place
      under *their* author name and creates no revision of ours — reporting
      success. That forges provenance, hides our redline, and is the common
      case from round two of a negotiation onward. Header and footer text is
      also unreachable by its edit API. Full evidence in
      `docs/library-evaluation.md`.
      Also corrected the plan: §1.6.2's reject-all oracle must be scoped to our
      own author, or it rejects the counterparty's pre-existing revisions too
      and winds the document back past what they sent.
      Five byte-stable synthetic fixtures landed with it (§1.11 nos. 1-4, 6).

- [x] **Stage 0 — validated the live redline engine (2026-09-07).** `lib/
      tracked-changes-docx.ts` ships in the app today and had only ever been
      run against clean hand-made files. Randomised testing found it producing
      **XML Word cannot open in 16% of realistic redlines** — it spliced across
      `</w:ins>` and `</w:sdtContent>` boundaries — concentrated on documents
      that already carry the counterparty's changes, i.e. every round after the
      first. Also: the "COULD NOT BE LOCATED FOR MARKUP" appendix heading was
      plain text, so it survived a reject-all and stayed in the contract
      permanently. Both fixed; 1000 randomised documents and 15 pinned seeds
      now pass. See `docs/live-engine-validation.md`.

- [x] **§1.4 Extraction and the source map (2026-09-07).** The accuracy fix.
      `mammoth.extractRawText` discarded every heading, table and list before
      `text-to-pdf` re-flowed the remains, so the model read cancellation
      schedules and attrition scales — the largest dollar exposure in the
      contract — as prose. `lib/docx/` now produces structure-aware text plus a
      character-to-run map, three views (a move treated as a move, not a delete
      plus an insert), header and footer parts, and flags for content controls,
      field results, tables, hyperlinks and existing insertions so §1.5.3 can
      refuse what it must. The intake health gate decides at upload, not export,
      whether a document can be edited.
      **Verified live**: uploading a table-heavy contract, the model quoted
      "Days Prior to Arrival | Damages (% of Room Revenue) | 365 or more | 25%"
      — it read the schedule as a grid. 20 tests including 100x determinism and
      map coverage across all 15 fixtures.
      *Open, for §1.5*: findings about a table quote across cell boundaries, and
      §1.5.3 blocks those spans — so table clauses may analyse well but not be
      redlinable in place. Worth deciding how to handle before §1.5 ends.

- [x] **§1.4a HTML preview (2026-09-08).** Closes the "DOCX-to-preview"
      priority below. The review screen's left pane used to render every
      DOCX/DOC upload through `convertToPdf()` → `mammoth.extractRawText()`,
      which discards tables/headings/lists before flattening to a PDF — so a
      cancellation schedule or attrition sliding scale showed as run-together
      prose even though the model reads it as a real table. For
      `intake_route === "docx_native"` analyses, `lib/docx-preview.ts` now
      parses §1.4's markup spans into an actual block tree (headings,
      paragraphs, lists, tables, with existing tracked changes rendered
      inline) and `app/(app)/analyses/[id]/docx-preview.tsx` renders it as a
      real web page — real `<table>` elements, not `#`/`|` decoration.
      Highlighting is an exact-then-normalized character-offset lookup
      (`resolveHighlight`) instead of PDF coordinate matching; genuine PDF
      uploads, `.doc`, and docx that fails the intake health gate all keep
      the existing pdfjs viewer unchanged. Scoped to the on-screen preview
      only — the upload pipeline and every export route (marked-up PDF,
      tracked-changes DOCX) are untouched for every source format, including
      docx_native, so `line-positions.json`/`text-to-pdf` are not fully
      retired the way this section's original framing below described, only
      narrowed to no longer govern the live preview.
      Also closed a real gap found while building the "round 2+" banner:
      §1.4.2's existing-revisions data (`had_existing_revisions`,
      `existing_revision_authors`, `existing_revision_count`) was computed by
      `extractDocx()` since §1.4 landed but never written to the DB or read
      by any route — wired up both directions now.
      **Verified live** against a real docx_native analysis
      (`cancellation-schedule-test.docx`): the cancellation schedule and
      attrition sliding scale render as real tables, and clicking a
      table-quoting finding correctly highlighted the matching cells. That
      live check caught a real bug: the model flattens a table quote as
      `"cell | cell | cell"`, omitting the extractor's own `| --- |`
      separator row that sits between the header and first data row in the
      real text — so exact and whitespace-normalized matching both missed
      it. Added a third "flattened" match tier against the parsed block
      structure (which has already dropped the separator row) to fix it.
      19 new tests (`tests/docx/preview.test.ts`), including a round-trip
      offset invariant across all 15 §1.4 fixtures and a regression test for
      the flattened-table-quote case. Additionally re-verified directly
      against 6 real docx_native analyses in the dev database (the one
      existing real upload plus 5 more created from fixtures 02/04/05/09/13
      via the same intake logic as the upload route) before merging — 0
      parse failures, 0 offset mismatches, existing-revisions persistence
      confirmed correct (fixture 04's two authors and counts landed exactly
      right). Full suite 102/102, typecheck and lint clean.

- [x] **§1.6 Validation oracle (2026-09-08).** The gap this closes was live:
      the export route generated a tracked-changes file and streamed it to the
      associate unchecked — no structural validation, no reject-all round
      trip, no Clean/Partial/Fallback classification, and nothing written to
      the `exports` table at all. Stage 0's invariants existed but only inside
      a fuzz harness, as regexes over a `word/document.xml` string.
      `lib/redline-validation/` is now a real module taking an original/output
      byte pair. It parses every XML and `.rels` part rather than only
      `document.xml`, checks Content_Types and relationship consistency,
      revision id uniqueness and range, insertion/deletion markup (nested
      del-inside-ins stays legal, since §1.5.7 needs it), and table shape row
      by row. Deliberately engine-agnostic — it validates the legacy engine
      today and §1.5's replacement unchanged, against a declared
      `RedlineEngineResult` contract rather than either engine's internals.
      Two corrections to the plan text, both in code with tests named after
      them: §1.6.2's round trip rejects only the revisions *this export*
      wrote and accepts everyone else's (rejecting all of them unwinds the
      property's edits and winds the contract back past what they sent), and
      attribution is by revision id rather than author name, so an export
      stays verifiable when the property's counsel shares a name with the
      associate. Paragraph counts are checked separately from text, because an
      inserted paragraph whose mark was never marked inserted leaves a blank
      paragraph on reject with no text difference to see — Stage 0's defect 3.
      **Found a fourth real defect in the live engine.** Pointing the 1000-
      document fuzz corpus at the new oracle failed 2-5% of documents
      immediately: the splice only indexes and re-emits `w:t` text, so a tab,
      line break or footnote marker caught between the first and last matched
      run was destroyed — silently, outside any revision mark. The engine now
      refuses those spans, the same conservative trade Stage 0 made for spans
      crossing a structural boundary.
      Wired into the request path, not left as a library: the route validates
      before streaming, Fallback discards the bytes and routes to the marked-up
      PDF, and `?preflight=1` lets the button show the Partial list before the
      download. All three export routes write `exports` rows, so §1.6.5's
      weekly review and §1.6.6's rate have data. §1.6.7 is asserted in
      `recordExport`, the only place an export path can be written, which
      refuses any path equal to the uploaded original or the analysed PDF.
      **Verified live** against a real 25-finding DOCX analysis: the Partial
      dialog listed both unapplied findings with plain-language reasons before
      download, and the `exports` rows landed correctly for redline, memo and
      marked-up PDF. That live check caught a real bug — one click on
      "Download anyway" wrote two rows, because a `next/link` pointing at a
      side-effectful export route fires on mount as well as on click. All three
      export controls are click handlers now, verified at one row per click.
      Corpus degradation rate 0% fallback with 3 Partials across 16 cases
      (`npm run export:degradation-rate`). 149 tests, typecheck and lint clean.
      §1.6.3's LibreOffice deep check stays dropped per CLAUDE.md.

- [x] **§1.5 Revision engine (2026-09-08).** Replaces `lib/tracked-changes-docx.ts`,
      which found text with regexes over `word/document.xml` as a string and edited by
      splicing that string. That technique is why it refused so much: it can only
      replace one contiguous stretch of characters, so any structure caught inside
      that stretch was destroyed. Stage 0 and §1.6 each found a corruption bug of
      exactly that shape.
      **The architecture question was settled by experiment before planning.** The old
      engine's header warned against parsing and rebuilding the XML tree. Measured on
      15 fixtures and 5 real Word/Google-Docs contracts up to 214KB, a parse-and-
      reserialise round trip changes exactly one character — the line ending after the
      XML declaration — which `serialize.ts` now preserves. So `lib/redline-engine/`
      edits a DOM, and only the parts it actually touches are written back.
      **Three refusals became real redlines**, each tested through §1.6's oracle: a
      change inside the counterparty's own insertion (§1.5.7's nested case, which falls
      out of working on the tree rather than a string), a change spanning a tab or line
      break, and a change inside a single table cell. Terms in headers and footers are
      redlined at last — `docs/live-engine-validation.md` had that as a known gap.
      Cross-cell table changes strike the table and insert a cloned, edited copy per
      the 2026-09-07 decision, with row-level markers and a separator paragraph so Word
      renders it correctly and does not merge the two tables.
      **One deliberate behaviour change.** A quote appearing in more than one clause is
      resolved by the finding's section reference or refused. The old engine took the
      first match, so a short repeated phrase could redline the wrong clause silently —
      on `02-heavy-tables.docx` it picked a row out of a cancellation schedule, which is
      the most expensive silent error available. Section references are matched against
      real headings and numbered clauses, not raw text, because searching a contract for
      "2" hits dates, room counts and dollar figures.
      **Evidence for the cutover**, from a harness running both engines over the same
      documents with fixed seeds: 250 generated contracts, applied 149 → 188, zero
      fallbacks; the 21 the old engine applied and this does not are all ambiguous
      quotes. On the fixture corpus 15 → 15 with two gained and two given up, both
      correctly — the ambiguous schedule row above, and text inside a content control
      that §1.4.7 and §1.5.3 both say to refuse and the old engine edited anyway.
      §1.5.11 is dropped (CLAUDE.md deviation 6): explaining a change inside the
      document puts CD's reasoning in front of the property and would have to be
      deleted before sending. The appendix carries proposed contract language only —
      the old engine's severity labels and its "COULD NOT BE LOCATED FOR MARKUP" list
      are both gone.
      **Verified live** against the real 25-finding `ConferenceDirect Ideal Standard
      Contract REVISED 2013.docx` in the dev database. The same analysis exported
      `partial, 0 applied` under the old engine and `clean, 3 applied` under this one.
      All ten oracle checks pass on the 187KB result, 14 of its 15 XML parts come out
      byte-identical, and `span_resolution`/`applicability` are now populated. Not
      opened in Word — verification is the reject-all round trip, not a human eyeball.
      `lib/tracked-changes-docx.ts` is deleted along with the two harnesses that
      existed only to exercise it (it was not, in fact, deleted until
      2026-10-10, on `audit/1-7-remove-old-engine`); Stage 0's findings stay in
      `docs/live-engine-validation.md`. 227 tests, 300 randomised documents, lint and
      typecheck clean.
      *Closed 2026-09-24:* a table quote that omits the extractor's `|` separators
      used to land just under the 0.95 fuzzy threshold (`13-nested-merged-tables.docx`).
      `locateQuote` now tries a pass with the separators set aside, and a proposal
      written without them is laid out across the cells by `splitAcrossCells`, which
      refuses rather than guesses when a change crosses a cell boundary. The card's
      warning uses the same split. A replay of 361 real quotes (two eval runs, four
      Florida runs) found none that had failed this way, and every one locates exactly
      as before, so this guards a failure not yet seen in real output.

- [x] **§1.7 PDF path, §1.10 AI-use pre-check, §1.9 multi-round hooks
      (2026-09-08).** Logged together; each is self-contained and shipped without
      incident. §1.7 is the intake-routing and export-fallback plumbing over
      `lib/redline-pdf.ts` — its LibreOffice worker stays dropped per CLAUDE.md
      deviation 1. §1.10 added `lib/ai-use-scan.ts`, a deterministic regex pass
      that runs before any network call and halts on an AI-use provision rather
      than auto-deciding, surfaced by `components/ai-clause-review.tsx`. §1.9
      added migration `004` plus `lib/negotiation-threads.ts`, so `thread_id`,
      `round_number` and `parent_analysis_id` populate from the first pilot
      contract — schema and linkage only, no diffing.

- [x] **§1.8 Email drafting — both audiences (2026-09-09).** Two emails from one
      review, deliberately different, from accepted findings only.
      The **client email** (§1.8.1/.2/.4/.5/.6/.7) carries CD's reasoning: plain
      business language grouped by theme, quantified exposure with its basis, and
      an explicit prompt ban on statements of legal effect. `lib/email-drafting/
      input-assembly.ts` filters to accept/edit and prefers the associate's edited
      language. Zero findings short-circuits to a fixed "reviewed, no proposed
      changes" message with no model call — added after live testing showed the
      call was wasted on a fully deterministic case. Per-associate signature block
      (migration `005`) is appended by the UI, never written by the model, so
      editing it does not require regenerating the email.
      **§1.8.3, the property email, is the opposite problem** and was built to the
      plan's own instruction: "a hard field allowlist on the payload, not a prompt
      instruction. A prompt can be talked out of it; a filter cannot." Exposure
      amounts, severity, `finding_text` (why CD flagged it) and `cd_standard` (CD's
      internal and fallback position) are all negotiating leverage and must not
      reach the counterparty. Enforced at three independent layers: a narrowed
      SELECT that never fetches those columns, a `PropertyEmailItem` type holding
      only `clause_type`/`is_missing_clause`/`proposed_language`, and a payload
      builder that names each field rather than spreading. `lib/email-drafting/
      property-assembly.ts` **duplicates** the client assembly rather than sharing
      a base type — one file now answers "what can reach the property?", and
      widening it cannot be a one-line change. The item type names its language
      field `proposed_language` where the client's `EmailFinding` uses `language`,
      so passing client findings into the property generator is a compile error.
      `proposed_language` is included because it is the redline text the property
      reads anyway; `quoted_text` is deliberately omitted, since handing the model
      the before/after pair invites adversarial framing.
      The contract label comes from the thread's `property_name`, falling back to
      "the agreement" — never the filename, which can carry CD's internal
      shorthand about the deal. With nothing accepted the route returns 400 rather
      than drafting a note describing an attachment that does not exist.
      **Both audiences are generate/edit/copy/download only. No send affordance
      anywhere**, verified in the DOM.
      **Verified live** against two real analyses (11 and 2 accepted findings). No
      excluded field reached either persisted draft. The first leak detector's
      residual hits were false positives — a rationale inevitably shares wording
      with the clause it discusses — and the discriminating terms settle it: the
      email says "without **liability**" (the proposed clause) not "without
      **penalty**" (CD's standard), "each party's own **negligence**" not "acts or
      **omissions**", and "**70%**" (the proposed term) not "**80%**" (the
      property's current term, named only in the excluded rationale). Exposure
      figures and severity vocabulary were absent outright.
      The allowlist tests assert on the **constructed payload**, not the type, and
      each layer was mutation-tested separately — the first payload-builder
      mutation passed because assembly had already stripped the fields upstream,
      so a second test feeds polluted items straight into the builder. Live testing
      also caught the model filling the empty label with a bracketed placeholder
      (`[Group Name/Event Dates...]`); the prompt now forbids placeholders and
      invented detail. 307 tests, lint and typecheck clean. Test drafts and seeded
      rows cleaned up; audit entries left intact as a compliance record.

- [x] **§2.1.1 Diff mechanics — the ungated half of the multi-round diff engine
      (2026-09-20).** Answers what is different between the version CD sent and the
      version the property returned, and which clause each difference sits in.
      Produces a comparison and nothing else: no finding is read and none is
      written, because turning a change into "they rejected this" is §2.1.2 and
      that is gated.
      **The plan's two paths collapse into one.** It describes a track-changes path
      and a clean-document path as alternatives. Built that way it would lose
      changes, because a property that accepts CD's edits before making its own
      erases the marks on the accepted edits — a reader of marks alone calls them
      untouched. The text diff always runs and is the authority on what changed;
      revision marks add who and when on top.
      **The renumbering trap.** §1.4's text carries list numbers, heading hashes and
      table pipes as synthetic characters, so one inserted clause renumbers
      everything below it and a naive diff reports a hundred changes for one edit.
      Both sides are projected to wording only, using the source map where there is
      one. The mapped and text-only projectors agree character for character on all
      fifteen §1.11 fixtures.
      **Alignment is patience diff over word tokens** — match the words appearing
      exactly once on each side, take the longest non-crossing run, recurse into the
      gaps, and fall to a bounded Myers pass where no unique word anchors a gap.
      Anchoring on rare wording is what stops a changed percentage being reported
      against the wrong copy of a clause that appears twice.
      **A baseline ladder, with the rung reported.** What CD sent, best available:
      the kept export, a rebuild of it, the property's own draft from that round,
      the stored text, then the PDF's text. The third rung matters most — against
      the property's own draft, a change CD asked for reads as a change they made,
      which is true of the text and misleading about the negotiation, so the panel
      and the CLI both say so.
      **§1.9.4 had never been built.** `exports.storage_path` has been in the schema
      since migration `002` and no caller ever passed one, so the redlined file an
      associate emails to a hotel was discarded after serving. It is the one input
      here that cannot be re-derived — a rebuild after a decision changed is a
      document nobody ever saw. Now kept, one file per export, nothing kept for a
      discarded validation fallback.
      **Found and fixed a live §1.4 bug.** §1.5's `replaceSpan` deliberately writes
      CD's `w:del` inside the counterparty's `w:ins` (§1.5.7). `walkRevision`
      descended into a nested revision's children and walked the runs with the
      enclosing views, losing the inner revision entirely: wording both sides had
      agreed to remove still read as present, credited to the wrong author. From
      round two of a negotiation onward that is the ordinary shape of a document.
      Views now compose by intersection and travel in the walk context. No existing
      test covered the case; all 818 now pass.
      **Verified live** against the largest real contract on file — 43,600
      characters, compared in 39ms, two simulated property edits both placed in the
      right clause — and against the one real pair of rounds in the dev database,
      which are byte-identical files and correctly report no changes.
      `npm run diff:round -- <analysisId>` prints a round; the thread page carries a
      read-only panel. §2.1.2 stays gated and untouched.
      **Note for §2.1.2:** `finding_outcomes` already exists as a real table in
      migration `002`, indexed and RLS-enabled. It needs no migration, only a writer.

## Build order progress (build brief §11)

**Now, on personal accounts, no CD data:**

- [x] 1. Analysis pipeline, headless — stage-1 library, structured outputs, inline PDF
- [x] 2. Eval harness against a synthetic answer key — **built 2026-09-09** as §2.0.1.
      Seven generated contracts, 90 key items, scored by document position rather than
      by clause name. `npm run eval:capture` then `npm run eval:score -- --run <label>`.
      See `docs/eval-harness.md`, including how CD's real key swaps in.
- [x] 3. Scaffold — Next.js, Supabase schema, own auth layer, and GitHub repo
      ([horanshea-ops/CD-Contract-Reviewer-Pro](https://github.com/horanshea-ops/CD-Contract-Reviewer-Pro))
      all done; **deploy not started**, still local-only (`npm run dev`).
      **Superseded 2026-09-19 by a hosting audit** (see below): the earlier note
      here said Vercel Pro ($20/mo) was needed because Hobby's 60s function limit
      is under the 300s analysis budget. The audit found the actual fix is
      cheaper and more robust than raising that ceiling — deploy to Render (or
      another host running a real persistent Node process) instead, where
      `after()` keeps running the same way it does in `npm run dev` with no
      function-duration ceiling to fight at all, at zero required app-code
      change. Vercel Pro's 300s cap was also uncomfortably close to a 5-minute
      review to begin with, so this isn't just cheaper, it's less fragile.
- [x] 4. Upload and analysis flow — async job via `after()`, status polling, real
      failure states (upload validation, malformed-model-output retry-then-fail)
- [x] 4a. DOCX/DOC upload (added to scope, competitor parity) — converted
      server-side to PDF (text extracted and re-flowed, not a pixel-faithful
      copy — the UI says so) and fed through the same pipeline unchanged. The
      original file is kept in storage either way, so the redline work below
      isn't foreclosed by this approach.
- [x] 4b. Marked-up PDF / tracked-changes DOCX (added to scope, competitor parity) —
      all three phases done. See open items below for what's still genuinely
      unvalidated (complex PDF layouts; a human opening the DOCX output in real Word).
- [x] 5. Findings review UI — document alongside findings, accept/edit/dismiss
- [x] 6. Audit logging — wired into login, upload, analysis complete/failed, every
      finding action
- [x] 7. Standards library admin screen — admin-only (enforced server-side, not just
      hidden nav), provenance visible and editable with a validation stamp
- [x] 8. Requested-revisions memo export (v1, PDF) — only accepted/edited findings
      are included (dismissed and undecided ones are excluded), sorted by severity
- [x] 9. Analysis history — folded into the dashboard's recent-analyses table rather
      than a separate screen; revisit if that's not enough once there's real volume

**When redacted contracts arrive, on CD's Anthropic org:** 10-12 not started — blocked
on the open items below (CD's Anthropic org, confidentiality review, named associates).

**After the accuracy gate:** 13-15 not started, correctly blocked on 10-12.

**Roadmap, not v1:** 16-17 deferred by design, see open items below. Item 18
(tracked-changes DOCX) is done — see 4b above and the open items below.

## Open items

### Beta preparation (user, 2026-10-06)

CD's second meeting went well and CD wants a beta. The beta tests the core
contract review: upload, review, redline and export. Work until then goes to
getting those right. This section orders that work and overrides "Next up"
below wherever the two differ. Each item gets its own plan before any code.

**Start here (state at the end of 2026-10-10).**

| | |
|---|---|
| Live model | Sonnet 5.5, since 2026-10-08. |
| Live on `main` | Everything built to date, 1,791 tests. Merged on 2026-10-10: the check before export, the one-kind filter and bubble labels, clause numbers and headings (audit 4.1, 4.4), text boxes with the unread-wording note (4.2), three small reader fixes (4.3, 4.7, 4.6 with 4.9), the accepted reading (4.5), Next.js 16.3.8 (audit 8.1), the after-sign-in redirect (8.2), and the memo saved as `internal-requested-revisions-<id>.pdf` (8.3). `phase/2-1-same-file-reuse` is parked. |
| Built, not merged | Nothing. |
| Current work | The core audit (user's goal, 2026-10-08). New features are on hold. See "Core audit" below and `docs/core-audit.md`. |
| Migrations applied | 015 to 017, and **018 on 2026-10-10**, all by the user. 018's columns were confirmed present the same day. |
| Rollback | Tag `archive/2026-10-08-pre-sonnet-5-5` is `main` before the 5.5 merge. Going back also means setting Render's model to `claude-sonnet-5`. |

**Do first next session.**

1. **Piece 8's fixes, in the order the user approved on 2026-10-10**, each
   with its own plan. The Next.js patch release (8.1) is live. The
   after-sign-in redirect (8.2) and the memo's file name (8.3) are live
   too. Next are the engine's input (8.5), the free parts of 8.4, and the headers
   (8.7). The prompt sentence in 8.4 needs a quoted paid run. See
   `docs/core-audit.md`, "Piece 8".
   - On 8.3 the user chose a file name that says internal, kept one zip
     for every file, and left the memo's pages as they are.

**Owed by the user. Remind them until each is done.**

- **Switch sign-ups off in the Supabase dashboard** (audit 8.6, asked to
  be reminded on 2026-10-10). Authentication, then Sign In / Providers,
  then "Allow new users to sign up". First check how a new associate's
  account is made today, since the sign-in page never creates one.
2. **A change to wording in a text box is refused on purpose.** Lifting
   that needs a made-up file with a change in a box, checked by the user
   in two viewers.
3. Then pieces 8, 3, 6, 7 and 9, in that order (user's "go", 2026-10-10).

**The check before export is finished and merged (2026-10-10).** With the
user's yes, one "This one" was clicked on the made-up Rome review
(`65f10383`), on the card whose quote "Office" is found 10 times. The card
read "Accepted" and kept that after a reload, and the saved row holds the
quote and the wording before the place picked. That card is now decided, so
it no longer shows the 10 places.

**Asked for by the user on 2026-10-10. Both done and merged the same day** (`ui/filter-and-bubble-labels`).

- **The Business, Legal and Other buttons filter to that list.** A push
  shows that kind alone, and a second push shows every kind.
- **Margin bubbles say what they are.** Each opens with "Comment" and its
  number, or with "Tracked change".
- Seen in the dev browser on `c7148b08`. Lint, the type check and 1,717
  tests passed on `main`.

**Watch on every new review (user, 2026-10-10).** If a change with no place
shows up on a real review, look at each one on its own before trusting the
general fix. Record the contract's wording, the model's quote, and what the
card offered, in `docs/core-audit.md`. None has appeared on Sonnet 5.5 in
188 changes, so the first real one is worth a close look.

**Not yet clicked by a person.**

- "Show me where" with its confirm, and "Send this in the email to the
  property", on a card whose change has no place. "This one" was clicked by
  Claude in the dev browser, not by a person.
- "Save and accept" on a blank field, and "Use" or "Keep" on an amount check.
- Accept All and Reject All on `data/private/replay/sample-across-paragraphs-redline.docx`
  in Word for the web.

**Open question for the user.** Does CD ever send a hotel wording with a
blank for the hotel to fill?

**What went live on 2026-10-10.**

- **Table rows are changed cell by cell.** The struck table and its copy are
  the fallback, used when two changes overlap.
- **A blank is a field on the card**, with "Save and accept".
- **Wording that runs across paragraphs is replaced as one joined change.**
  The user's test in Word for the web showed the joined paragraph keeps the
  first paragraph's formatting.
- **The old redline engine is deleted.** CLAUDE.md deviation 4 is closed.
- **The amount check has two buttons**, "Use" and "Keep".
- **An engine crash takes the marked-up PDF route** and is recorded as a
  fallback.
- **The clean Word copy is checked before download.** The check before
  export replaces the list it showed.

**What went live on 2026-10-08.**

- **Sonnet 5.5**, with the two-call review, the streamed review call, a
  10-minute limit, a 100,000-token output cap, and the second ask for
  clauses judged short with no finding (capped at 8). Every call sends
  thinking allowed at effort `medium` (`ANSWER_DEFAULTS`).
- **The standards loader fails loudly.** Three tries, then the review fails
  with a plain message, in place of silently using the bundled library.
- **The card flags a proposed amount that no longer follows from its
  formula** (`lib/proposed-figures.ts`).
- **The brand on the new-review form** is required and read by family.
- **Each standards set lists the brands it covers**, at the foot of the
  Standards screen, one to a row, and an admin adds or removes them.

**Carried over from 2026-10-08, still open.**

1. Ask how the first live review on Sonnet 5.5 went. No real contract has
   run on the final setting.
2. One client-email draft on the new setting, about 2 cents, with a yes.
3. Ask the user to look at the brand a real upload reads.

**Waiting on CD. Each needs a check on Riverwalk (about $0.30) when it lands,
because it changes the library or the instructions.**

- Which findings earn a card. The user said on 2026-10-08 that 100 cards
  add no value, since an associate will accept or ignore them blindly. The
  preferred route is CD marking must-haves per standard. Cutting
  low-severity findings is the fallback.
- Whether a contract with one fixed rate for one event should get a
  future-rate-cap finding. Sonnet 5.5 judged it not applicable on all four
  runs, and the answer key expects a finding.
- The updated Independent baseline, the Hilton and Hyatt contracts, and
  CD's own Anthropic API key (deviation 9).
- What CD's Hilton and Hyatt agreements really cover. The two brand lists
  are the app's own guess.

**Rules for paid runs** are under item 2 below ("Rules for paid runs, from a
self-audit the user asked for"). Spend on 2026-10-07 and 08 was about $3.00.

History of the switch, oldest first:

1. **Done 2026-10-07, on `review/one-reading-pass`, not merged: the review
   call is streamed, and a review gets 10 minutes.** Harborview failed on
   Sonnet 5.5 twice that day, at 9m23s with no limit and at 301s with a
   420s limit. The cause is proven. Node drops a request that has heard
   nothing back for 300 seconds, and an unstreamed review is silent until
   it ends. It applies to Sonnet 5 on the live build too, whose slowest
   measured review took 253s. The evidence is under item 2 below.
2. **Done 2026-10-07, same branch: output cap 100,000, the second ask for
   skipped write-ups, and an eval switch for effort and thinking.** One paid
   Harborview run with thinking on at `low` scored 33 of 34 in 237s for
   $0.628. It did not test thinking, and the second ask did most of the
   work. The detail is under item 2 below.
3. **Done 2026-10-07, live on `main` (`6c3f988`): the standards loader
   no longer falls back in silence.** A one-off database error (`JWT issued
   at future`) had sent a paid run to the bundled library. A read is now
   tried three times, then the review fails with a plain message. No
   finished review was ever affected (19 of 30 record the database, 11
   predate the record).
4. **Done 2026-10-07, on the branch: Riverwalk with thinking allowed at
   effort `medium` passed its bar.** 26 of 27 in 130s for $0.278. The model
   chose not to think. Detail under item 2 below.
5. **Next paid run, on hold, needs a yes: Harborview with thinking allowed
   at effort `medium`**, about $0.45 to $0.60. Pass is 32 of 34 inside 10 minutes with the second
   ask covering 8 clauses or fewer.
6. **On a pass, Florida through the app if the setting changed, then merge
   and deploy.** The user then changes Render's `ANTHROPIC_MODEL` to
   `claude-sonnet-5-5`.

**Owed by the user.**

- ~~**HIGH PRIORITY: look at two rebuilt redlines in Word.**~~ **Checked by
  the user in Word for Mac, 2026-10-08. Both table fixes render correctly.**
  - `4f803f16-redline.docx`: the schedule is struck once and inserted once,
    all five tiers changed. `4a7e89f6-redline.docx`: each tier's amount is
    struck with the new one beside it, "times 70%," is inserted, and the
    schedule appears once. Both `-clean.docx` files read correctly.
  - **Still untested by a person: Accept All and Reject All.** The user's
    Word licence is view-only. The app's own reject-all round trip passes
    on both files. Low priority, for whenever an editable Word is to hand.
  - **The check showed two wrong figures inside the tables. They are the
    model's arithmetic, and the table code placed them faithfully.** On
    `4a7e89f6` the last F&B tier reads $80,000 beside "times 35%". On
    `4f803f16` it reads $64,000 beside "times 80%". The tier above
    ($50,000 at 50%) puts the minimum at $100,000. The two reviews also
    worked the room fees from different minimum room nights. This is free
    work item 4 below.
- ~~Delete `ANALYTICS`, `ANALYTICS_SOURCE` and `ANALYTICS_DEMO` on
  Render.~~ Done by the user, 2026-10-08.
- ~~Read the Claude Console's usage for 2026-10-07.~~ The user reported
  $2.30 spent since the reload (2026-10-08). $1.34 is itemised: Florida
  $0.381, the compile check about $0.05, Harborview at `low` $0.628 and
  Riverwalk at `medium` $0.278. The other $0.96 matches the two Harborview
  calls that timed out on the morning of 7 October, so a timed-out call is
  billed in full.
- ~~Fix one sentence in the gratuity standard.~~ Done by the user,
  2026-10-08, by removing the phrase.
- From CD: updated Independent baseline, Hilton and Hyatt contracts, and
  test contracts. Leave the hotel's brand in when redacting, or use a
  stand-in such as "Hilton Sampleville".

**Not yet checked by a person.**

- The brand read off an uploaded file, and the grey line under it.
- Copy, Switch on and Switch off on the Standards screen. Copying
  Independent into Hilton is the intended first step when CD's Hilton
  contract arrives.
- Accept All and Reject All in Word on a redline (the user's Word licence
  is view-only).

**Free work waiting, in a sensible order.**

1. ~~Streaming~~, done above.
2. The card can't warn when a change inside a table cell will be left
   out, since the stored review text has no paragraph breaks inside a cell.
3. ~~A replaced table that holds a hotel comment still falls back to PDF.~~
   Built 2026-10-08 on `phase/1-5-table-cells-in-place`, not merged. See
   "Table rows, cell by cell" below.
4. Items held for a paid run: `[X]%` on gratuity, table rows written as
   prose, and the model's own arithmetic in proposed wording. On
   `4a7e89f6` it changed an F&B formula to 35% and left the amount at
   $80,000.
   - **Live on `main` since 2026-10-08 (`197ea1f`): the card flags an
     amount that no longer follows from its formula** (`lib/proposed-figures.ts`).
     It gives the amount the contract's own base produces, warns without
     holding the change out of the redline, and makes no model call. A
     replay over all 30 stored reviews (975 findings, 26 with an amount
     beside a formula) flagged 6, all in the two reviews known to be wrong.
     The model still makes the mistake. This catches it for the associate.
5. **Done 2026-10-08, live on `main`: the brand on the new-review form
   (user's rules, same day).**
   - **A brand is entered on every new negotiation.** The field is
     required, and the upload is refused without one. A hotel of no brand
     is entered as "Independent".
   - **A family's lines are not told apart, for every family.** Hyatt
     Regency is read and recorded as Hyatt, DoubleTree and Hilton Garden
     Inn as Hilton, Sheraton as Marriott. Lines without the family in
     their name (Andaz, Thompson, Conrad) now get the family and its
     standards. Three families show their parent company: IHG, Accor and
     Choice. This answers question 2 for CD.
   - The grey line under the field says which standards the review will
     use (`lib/intake/brand-line.ts`). A brand with none of its own reads
     "There are no specific standards for this brand, so this review will
     run against Independent's standards."
   - No database change. Negotiations already stored keep their brand.
   - Lint, the type check and 1,589 tests pass. Each line was read in the
     dev browser by typing a brand. Not checked there: the brand read off
     a picked file, since the dev browser can't pick one.
   - **Done 2026-10-08, live on `main`: each set shows the brands it
     covers, and an admin edits the list** (user's idea and rules, same day).
     - The list is at the foot of the Standards screen, below the set's
       standards, one brand to a row (moved there at the user's request the
       same day), with a Remove button on each row and a box to add one. Independent has no list,
       because it takes every hotel no list names.
     - **The list alone decides coverage** (`placeBrand` in
       `lib/intake/brands.ts`). A brand on a list is shown and recorded
       under the set's name. A brand taken off its family's list runs
       against Independent, and the new-review form says so. The code's
       own brand list still finds a brand's name in a contract, and names
       families CD has no set for.
     - A brand sits on one list only. A set's own name stays on its list.
       A change reaches negotiations started afterwards, and every change
       is in the audit log with the list before and after.
     - Migration 017 filled the two lists (Hilton 15, Hyatt 11), applied by
       the user on 2026-10-08. **The lists come from the app's built-in
       list, not CD's agreements. CD should read them.**
     - Lint, the type check and 1,606 tests pass. In the dev browser, with
       the user's approval of one write to the shared database: a brand
       another set lists was refused, "Zz Test Brand" was added to Hyatt
       and removed again, and the new-review form placed Andaz, DoubleTree
       and Sheraton correctly against the real lists.
   - Also here: a screen to add a fourth standards set.
6. The hand-off guide (item 7 below).

**Table rows, cell by cell (user's decision, 2026-10-08). Built on
`phase/1-5-table-cells-in-place`, not merged.**

- **The rule.** A change that spans table cells is made as one in-place
  change per cell, and the table stays where it is. The engine strikes the
  table and inserts an edited copy only when it can't place the change cell
  by cell. This replaces the table rule of 2026-09-07.
- **Why.** A row change on a table holding a hotel comment sent the whole
  export to the PDF, because the copy repeated the comment's markers. The
  roadmap's own fix was to refuse the change. The user rejected that. A
  change is fixed in the redline before it is skipped.
- **Order the engine tries, for a change spanning cells.**
  1. The table is one this export already struck and copied. The change goes
     into that copy.
  2. Cell by cell, in place.
  3. Strike the table and insert an edited copy.
  4. Leave the change out.
- **What sends a change to step 3.** A cell holds two lines and the change
  runs across the break with no unchanged word between. Or the change
  overlaps wording an earlier finding already marked up.
- **One skip survives.** A step-3 case on a table holding a hotel comment is
  left out under its own reason (`table_holds_comment`), since that table
  can't be copied. No stored review hits it.
- **Two defects found and fixed on the way.**
  - New wording copied the old wording's formatting with any tracked
    formatting change on it, which repeated that record's id. The oracle
    doesn't count that kind of record.
  - **A crash, live on `main` today.** A refused change could split a run,
    and a later finding on the same run then threw. The export failed. Every
    route that can split a run now reads the document afresh.
- **Checks.** Lint, the type check and 1,623 tests pass.
- **Free replay, 25 stored Word reviews, 653 findings, old engine against
  new.** Every review applies the same findings on both (601 in all), and
  every oracle check passes on both. `4f803f16` and `dd0f4ca0` each had five
  changes in a table copy. All ten now go in the cells, and no review uses
  the copy.
- **The user's look in Word, done. Merged to `main` on 2026-10-10.** Both
  files are in `data/private/replay/`.
  - ~~`4f803f16-redline-cells.docx`. The cancellation schedule appears once,
    with each fee struck and the new one beside it.~~ Opened by the user in
    Word for the web on 2026-10-10. The schedule looked good.
  - **The user noticed that the other tables sit oddly to the right.** That
    comes from the uploaded file, and the app changed nothing there. Eight
    of the nine tables are identical in the original and the redline,
    character for character, and the ninth differs only by our changes.
    The shifted tables are the five the file sets as centred with an indent.
    The file's markup looks like an export from Apple Pages. A hotel's own
    Word file is unlikely to carry it.
  - ~~`sample-hotel-comment-redline.docx`, a made-up schedule. Same, with the
    hotel's comment still on the 75% cell.~~ Opened by the user on
    2026-10-09. It looked good.
  - Look for a repair prompt, a figure in the wrong column, or a table that
    appears twice.
- **Left out across the 25 reviews, 52 of 653 changes.** A blank left in the
  wording 31, a table or paragraph boundary 9, a rewrite with no quote 7,
  wording not found 4, a quote found twice 1. On the four Sonnet 5.5 reviews,
  3 of 188, all blanks. This is the core audit's first piece.

**Core audit (user's goal, 2026-10-08). New features are on hold.**

The beta should deliver a clean, polished core: upload, review, redline and
export. Much of the code was written by Opus 5 and Sonnet 5. Opus 5.5 reads it
again, piece by piece, and asks of every special case, refusal, fallback and
warning whether it is needed and whether the work can be done more simply.

- **Findings live in `docs/core-audit.md`**, one section per piece. Each
  finding has its evidence, what it costs the associate, a proposed fix, the
  fix's risk, and whether it needs a paid run.
- **Rules.**
  - The audit is free. It reads code, runs local tests, and replays stored
    reviews read-only.
  - A change is fixed in the redline before it is skipped (user, 2026-10-08).
  - No fix is built from the audit without its own plan and the user's yes.
  - A fix to the engine is proven on the replay before it merges.
  - A change to what the model is asked is listed and held for a paid run.
  - Archived features stay archived. The audit checks only that each is
    cleanly off.

| # | Piece | What it asks | State |
|---|---|---|---|
| 1 | Changes left out of the redline | Every refusal reason and oracle check. How often each fires on stored reviews, and whether a route exists that applies the change. | Findings written 2026-10-08. Five fixes proposed, none built. |
| 2 | What the associate is shown | Every yellow box, card warning and export message. Whether each needs a decision, and whether fixing its cause removes it. | Finished 2026-10-10. The amount-check buttons are live. The second pass (export dialog, email panels, new-review form) proposed no new fix. 2.4 and 2.5 wait on evidence from the beta. |
| 3 | The review call | Retries, the second ask, the reading call, findings the app raises itself, and every rule that patches the model's answer. Which exist for Sonnet 5 and are unneeded on 5.5. | Not started |
| 4 | Reading the Word file | Extraction, the source map and the preview. Special cases and paths kept from before the HTML preview. | Finished 2026-10-10. All six fixes are live. |
| 5 | Exports | Redline, clean copy, both PDFs, the zip, the memo and both emails. The fallback order and what each failure tells the associate. | Finished 2026-10-10. Both fixes are live. 5.3, a format of its own for the clean copy in the record, is left for later. |
| 6 | Dead and doubled code | The old engine (`lib/tracked-changes-docx.ts`), helpers written more than once, unused switches and scripts. | Not started |
| 7 | Upload, brands and standards | The intake rules, the brand lists and the set loader. | Not started |
| 8 | Security boundaries | Sign-in, row-level security, key handling, and the two allowlists that keep CD's position out of what a hotel sees. | Findings written 2026-10-10. Eight fixes proposed. The first (8.1) is live. The database wall and every route's checks were found sound. |
| 9 | Tests and CI | Tests that pass without checking anything (one was found on 2026-10-08), and gaps in the core path. | Not started |

- **Piece 1's proposed fixes, in order.** Each waits for a plan and a yes.
  1. ~~Blanks as fields on the card.~~ **Built 2026-10-08 on
     `audit/1-1-blank-fields`, cut from the table branch, not merged.**
     Blanks are 31 of the 52 left out, and all 3 on Sonnet 5.5. The card
     shows a field per blank and one button that saves and accepts. 1,643
     tests pass. The save was not clicked in the dev browser, since it
     writes to the shared database.
  2. One engine route that replaces wording across paragraphs. It removes 4
     refusals, the struck table's first trigger and the one skip left.
     ~~Held 2026-10-08.~~ **Built 2026-10-09 on
     `phase/1-5-across-paragraphs`, not merged.** The user's Word test
     showed joined paragraphs take the first one's formatting, which is what
     the route needs. The replay goes from 601 to 605 applied, all four
     stored cases apply, and no review uses the table copy. 1,658 tests pass.
     The clean copy joined paragraphs the wrong way round and is fixed.
  3. Widen the oracle's id check to every kind of tracked-change record.
     **Dropped 2026-10-09.** Word opened a file with a repeated id and
     showed no repair message, so the check would guard against nothing.
- **Word tests, run by the user on 2026-10-09 in Word for the web.**
  - `word-check-ids.docx` opened with no repair message.
  - Accept All on `word-check-accept-all.docx` gave AAA BBB on one centred
    line and NEW WORDING as numbered clause 2. **Joined paragraphs take the
    first paragraph's formatting.**
  - Reject All restored every paragraph.
  - This is the first time a person has pressed Accept All and Reject All
    on a file of this app's making. Desktop Word is still untested.
  - Only made-up files go to Word for the web. Redacted contract files
    stay on the user's machine.
- **Owed by the user.** Accept All and Reject All in Word for the web on
  `sample-across-paragraphs-redline.docx`, against its `-original`. Clause 2
  should become one numbered sentence, and the table cell should read
  "$35,000 [35% of the minimum]".
  4. ~~Remove the old engine (`lib/tracked-changes-docx.ts`), which nothing
     in the app uses, and two refusal reasons that can't appear.~~ **Done
     2026-10-10 on `audit/1-7-remove-old-engine`, not merged** (user's yes).
     717 lines gone, CLAUDE.md deviation 4 closed, 1,648 tests pass.
- **The user's answers on piece 2 (2026-10-10).** Buttons on the amount
  check are fine to try. The document notes stay as they are until CD
  gives direction.
- **Buttons on the amount check, built and merged 2026-10-10.** The box
  offers "Use" the worked-out amount or "Keep" the amount as written, and
  goes once either is pressed. 1,660 tests pass. On the two Sonnet 5.5
  reviews that carry the check, no card shows a yellow box any more.
  Neither button's save has been clicked by a person.
- **Piece 2, first pass (2026-10-10).** On the four Sonnet 5.5 reviews (255
  findings) the only yellow box left is the amount check, 6 times. Proposed:
  buttons on the amount check so it is a decision, a choice for the user on
  the 4 to 7 document notes per review that no export uses, and the engine's
  own sentence in the export dialog. A larger idea, running the real engine
  as the card's check, waits on evidence from the beta.
- **Order for the rest (user's "go", 2026-10-10).** Piece 5, then 4, then
  8, then 3, then 6, 7 and 9. It follows risk to the beta.
- **Piece 5, exports (2026-10-10).** Two gaps. An engine crash shows a bare
  error with no PDF and leaves no record, so the fallback rate can't see a
  crash. And the clean Word copy can lack a left-out change with no notice
  on the screen or in the file. Both fixes are small and free.
  **Both built and merged 2026-10-10.** 1,667 tests pass. The clean copy's
  list was seen in the dev browser on `98d84aa5`. The crash screen rests on
  tests, since no stored file crashes the engine.
- **The check before export (user's direction, 2026-10-10). Built on
  `audit/2-4-check-before-export`, not merged. It waits on migration 018.**
  - The user's rule. A change that can't be exported is raised before the
    export screen, on its card, with a specific way to settle it. "Raise it
    another way" is not an instruction.
  - The redline engine now runs when a Word upload's review screen loads.
    Each card shows what the redline will do with its change.
  - A change with no place can't be accepted until it is settled. The card
    offers a pick among several places, a selection in the document pane, a
    choice between two overlapping changes, or the email to the property.
  - The property email lists changes sent that way, written by code after
    the model's draft. The model never sees the list.
  - The export screen no longer lists changes that could not be included.
  - 1,717 tests pass, and the replay places the same 605 changes. Details
    and three departures from the plan are in `docs/core-audit.md`, 2.4.
  - **Migration 018 was applied by the user on 2026-10-10.**
  - **No save has been clicked.** One save on a made-up review needs the
    user's yes, and the merge follows it.
- **Piece 4, reading the Word file (2026-10-10).** Findings written and six fixes proposed. The first, clause numbers and headings (4.1, 4.4), was merged on 2026-10-10 after the user checked Florida's 30 numbers against the contract. The scripts in `data/private/audit/`, which git ignores, hold the before-and-after of the reader (`reader-snapshot.ts`, `reader-compare.ts`) and the replay (`replay.ts`).

**Archived for the beta.** Three features are off the live build and kept in
the repository. `docs/archived-features.md` says where each one's code lives,
what switches it back on, and how well it worked on the day it was archived.
Tag `archive/2026-10-06-pre-beta` marks the last commit with all three live.

| Feature | Switch | State |
|---|---|---|
| Analytics tab | `ANALYTICS=on` | Archived |
| Historical contract uploads (Admin tab) | `HISTORICAL_CONTRACTS=on` | Archived |
| Exposure math in a review | `EXPOSURES=on` | Hidden on screen and in the client email. The figures are still worked out until item 2 merges. |

- Findings still state the contract's numbers and CD's. The associate works
  out the dollar risk.
- The checks on the contract's own totals and dates stay
  (`lib/document-checks.ts`, `lib/date-checks.ts`).
- Exposure was archived because its figures varied between runs on the same
  contract. The arithmetic was steady. The numbers the model read were not.

**Deployed 2026-10-07 without the paid runs (user's instruction).** The work
that changes nothing the model is asked went to `main` on
`deploy/brand-sets-and-intake`: standards sets by brand (item 3), the upload
confirm step with the Hotel brand field (item 4), and the `EXPOSURES` switch
for what is shown. Every pinned model request is unchanged.

- **Still on `review/one-reading-pass`, waiting on the paid runs:** Sonnet
  5.5, the two-call review, and the reading call cut to five terms. Until
  then a review on `main` still asks the model for its figures and works the
  exposures out. They are stored and not shown.
- `standards/brand-sets` and `upload/intake-confirm` are superseded by the
  deploy branch.

**Order of work.**

- [x] **1. Archive Analytics and historical uploads (2026-10-06, branch
      `beta/archive-analytics-historical`).**
      - Analytics already had its switch. Removing `ANALYTICS`,
        `ANALYTICS_SOURCE` and `ANALYTICS_DEMO` on Render hides it. Only the
        user can do that.
      - Historical uploads gained `HISTORICAL_CONTRACTS`. Off, the Admin link
        and the old Historical contracts address both open Users, and its
        five routes return 404.
- [ ] **2. Sonnet 5.5, with exposure archived on it. Required before the
      beta**, so the beta tests the model that ships.
      - Branch `review/one-reading-pass` holds the 5.5 work (item 0 below).
        About half its commits rebuilt exposure on a second "reading" call, so
        exposure is archived there and not on `main`.
      - Add `EXPOSURES`, off by default. Off, no figure is read, computed or
        shown, on the cards, the overview bar or the client email, and the
        eval stops grading exposure.
      - Proposed: a prompt rule that findings, wording and the client email
        state the contract's number and CD's number and do no arithmetic. A
        4 October run wrote $213,023.60 where the sum is $214,023.60.
      - To decide in its plan: whether the reading call stays for the three
        numbers the app raises itself when the review drops them (commission
        rate, attrition floor, F&B shortfall rate). It costs 5 to 7 cents a
        review. The alternative is one call a review and no safety net.
      - Paid runs, each quoted first: Florida on 5.5, then the seven-contract
        eval. Then merge, then Render's `ANTHROPIC_MODEL` with the user's yes.
      - **Free part done 2026-10-06, on the branch, not merged.**
        - `main` is merged in with no conflicts, so the branch carries the
          table and bracket fixes.
        - `EXPOSURES` is in (`lib/exposures/enabled.ts`), off by default.
          Off, no finding carries a figure, and a review that stored
          figures hides them on the screen and in the client email.
        - **The reading call stays, for five terms only** (user, 2026-10-06,
          by approving the plan). It feeds the three findings the app
          raises itself. It costs about 5 cents on a review of about 45.
          It also writes the attrition room-night count the model left as
          `[X]` on `dd0f4ca0`.
        - No prompt wording changed. Every pinned request is unchanged, and
          the shorter reading request is pinned for both models.
        - **The no-arithmetic prompt rule is held back.** It would stop the
          model's wrong sums, and it would also make the model write `[X]`,
          which keeps a change out of the redline. Judge it on the paid
          run.
        - Lint, typecheck and 1,464 tests pass. The free request check
          accepts all 16 pinned requests. Checked in the browser on
          `cb3daee0`: no figure with the switch off, $170,696 with it on.
      - **Paid tests, 2026-10-07, on a $1.50 budget from the user. Not
        merged: one of the two runs didn't finish.**
        - **Florida `4a7e89f6`, through the app on Sonnet 5.5 ($0.381,
          3m42s, no thinking). Passed.**
          - 57 findings: 40 business, 8 legal, 9 other. 37 of 37 changed
            clauses quoted. No finding carries a dollar figure.
          - Attrition, commission and F&B all have findings. The app
            raised the F&B shortfall finding itself (80% against 35%).
          - 32 clauses were judged short or missing. Two got no finding
            (banquet service levels, labor disputes), and the note names
            them. The 4 October run left seven.
          - The reading call asked for the five must-raise terms and cost
            about 5 cents. The review recorded `independent` as its set.
            The upload's audit row holds the property name the app read.
          - One yellow box, `[X]%` on gratuity. This is the first 5.5 run
            to carry it.
          - Redline replay: 33 of 40 applied, every oracle check passed.
        - **Open problem this run shows: the cancellation tiers stay out of
          the redline, with no warning on the card.** Five cancellation
          changes and one F&B change were left out as "runs across a
          paragraph break". The model quoted one table cell, and that
          cell holds two paragraphs (the amount, then the bracketed
          formula). The same happened on `9244158e`. On `4f803f16` the
          model quoted whole rows and all applied. Fix: treat a change
          inside one cell that spans its paragraphs as a table
          replacement. Engine work, free, and it needs its own plan.
        - **Harborview eval on 5.5 did not finish.** It ran 9m23s with no
          answer, against 3m36s on 4 October, and was stopped before the
          SDK's own retry at 10 minutes could charge again. Whether the
          call was billed is unknown. Bayfront was never reached.
          - The eval path gives the call no deadline, so it waits 10
            minutes and then retries up to twice, and `with-retry.ts`
            retries up to four times on top. The app caps a call at 7
            minutes with no retry.
          - Florida was started while Harborview was running. That may
            have slowed it, and it muddies the reading.
          - In the app a 9-minute call would have been cut at 7 minutes
            and the review lost. One slow call is not a pattern, and it
            isn't cleared either.
        - **Second Harborview try, 2026-10-07, alone and capped: failed
          again. The 5.5 branch stays unmerged.** The call ended with
          "Request timed out" at 301 seconds, though its limit was 420.
          Run record: `data/eval/runs/sonnet55-harborview-2026-10-07.json`.
          - **A review call was one long request with no bytes coming
            back until it ended, and it was dropped at five minutes.**
            The first try that morning
            had no limit, the SDK retried after the first drop, and it was
            partway into a second attempt at 9m23s. Florida passes because
            it finishes in 3m42s. Harborview finished in 3m36s on 4 October
            and needs longer now.
          - **It matters beyond the eval.** Any review in the app that needs
            more than about five minutes would fail the same way, on either
            model.
          - Cost of the day's two failed tries is unknown. A timed-out call
            may be billed for what it generated. The user should read the
            Console's usage.
        - **Cause proven and fixed, 2026-10-07 (free, commits `f4f2c93` and
          `2c79da5`).**
          - **The cause is Node.** Its built-in `fetch` stops waiting when a
            server has sent nothing for 300 seconds. The SDK reports that
            as "Request timed out", so it read as our own limit. Render,
            the network and Anthropic play no part.
          - **Proof, against a stand-in server on the dev machine.** An
            unstreamed request with a 420s limit failed at 301.3s with the
            same message. A streamed request whose answer came at 320s
            finished at 320.0s.
          - **The SDK's `timeout` covers only the wait for a stream's first
            byte.** A stream given a 5s timeout ran 20s unstopped. So the
            deadline stops the stream with a timer of its own
            (`streamedMessage` in `lib/anthropic.ts`). A review stopped
            that way says how many characters of the answer had arrived,
            and is not retried.
          - **A review gets 10 minutes, up from 7 (user, 2026-10-07).** The
            stalled check moved from 10 minutes to 12 to stay above it,
            and the three review routes' `maxDuration` to 720s. The
            64,000-token output cap is a separate ceiling.
          - **Left unstreamed on purpose:** the reading call and the two
            email drafts. They finish far inside 300 seconds, and a failed
            reading never fails a review.
          - **Checks.** Lint, typecheck and 1,553 tests pass. No pinned
            request changed, and the free request check accepts all 16.
            The real `analyzeContract`, pointed at the stand-in server,
            returned an answer that took 320s, stopped a stalled stream at
            its 30s limit, and read a Sonnet 5 tool answer sent in pieces.
          - **Not yet known: how long Harborview needs now.** Both tries
            were cut off. Streaming removes the five-minute ceiling and
            makes no review faster.
        - **Output cap raised to 100,000 tokens (user, 2026-10-07,
          `eeb3565`).** Sonnet 5.5 writes about 180 tokens a second, against
          about 120 on Sonnet 5, so it reached the old 64,000 cap at under
          six minutes. A review's time is its output tokens divided by that
          speed, on every run recorded.
        - **Second ask for skipped write-ups (`53c9699`).** On 4 October
          three of the four key items 5.5 missed were judged short in its
          own checklist and never written up. `reviewContract` now asks
          the judging call once more, with the library cut down to those
          clause types and the first verdicts quoted. It never fails a
          review. Its usage is saved in `token_usage.follow_up`.
        - **Eval switch (`f3eb6b8`).** `eval-capture` takes `--effort` and
          `--thinking adaptive` for the judging call. The app's requests
          are unchanged. A review records `thinking_tokens`.
        - **Paid run `sonnet55-harborview-think-low-2026-10-07` ($0.628,
          237s): thinking on, effort `low`.**
          - 33 of 34 key items, against 30 on 4 October. The one miss is
            the future rate cap, which the model judged not applicable.
          - **It did not test thinking.** The API reported no thinking
            tokens on the first pass. At `low` the model skips it.
          - **At `low` the first pass stopped early.** It wrote all 34
            verdicts and findings for two clauses, 4,939 tokens in all.
            Alone it would have found about 3 of 34.
          - **The second ask did the rest.** Asked for 30 clauses, it
            wrote 64 findings and covered all 30, in 36,569 tokens.
          - 72 findings: 64 business, 8 legal, none marked other. Redline
            replay applied 63 of 64, with no failed check.
          - Cost ran above a one-pass review because the contract went
            out three times and the library was written to cache twice.
          - **Caveat: it used the bundled library**, after a one-off
            database error. The 4 October run used the database's copy
            of that day. The two scores are not like for like.
          - **Lead worth a plan after the beta:** judging first and
            writing findings second, as two deliberate steps. The second
            step skipped nothing here, and it could run in parallel.
        - **Sonnet 5.5: the finish line (user approved, 2026-10-07).** One
          fixed setting must pass all four.
          - Riverwalk: 26 of 27 key items or better.
          - Harborview: 32 of 34 or better, inside 10 minutes.
          - The first pass writes its own findings. The second ask covers
            8 clauses or fewer.
          - Florida through the app completes, and its redline rebuilds
            with no failed check.
        - **Rules for paid runs, from a self-audit the user asked for.**
          - One change per run, against a named comparison.
          - The smallest contract that can answer the question.
            Harborview is for the final gate.
          - Every proposal lists what could make the run tell us nothing.
          - Every quote carries a ceiling, and `--limit` enforces it.
          - A suspected cause is proven on the stand-in server first.
        - **Second ask capped at 8 clauses (`07d46e8`).** More than 8 left
          without a finding means the first pass stopped early. The review
          fails with a plain message. Each call's time and thinking tokens
          are recorded, and the eval prints its terms before it spends.
        - **The answer key was left alone on purpose.** A rebuild is free
          and would only restamp it. Its checks are hand-written from the
          bundled library. Today's library differs from that copy in 25
          of 34 standards, nearly all by two to four characters. Attendee
          data handling is a third shorter, commission's severity changed,
          and termination rights' fallback wording changed.
        - **Paid run `sonnet55-riverwalk-think-medium-2026-10-07` ($0.278,
          130s): thinking allowed, effort `medium`, live library.**
          - 26 of 27 key items. Sonnet 5 found 27 of 27 in 167s on 23
            September, on an older prompt.
          - **The model did not think.** The API reported no thinking
            tokens, and the billed output (16,479 tokens) matches the
            length of the answer alone. Allowed to think at `low` and at
            `medium`, Sonnet 5.5 goes straight to the answer on this job.
          - **The first pass was complete.** One clause (named storm) was
            judged missing with no finding. The second ask wrote it in 6
            seconds for about 3 cents, which is the job it was built for.
          - 39 findings: 29 business, 7 legal, 3 other. 31 clauses have a
            finding, 27 of them exactly one.
          - Seven findings sit on clauses the key says the contract meets
            (F&B minimum, vendors, master account, cutoff date, mandatory
            fees). Sonnet 5 had three such on 23 September.
          - Redline replay applied 28, with no failed check. One was left
            out for an unfilled `[X]%` on gratuity.
          - **The one miss is the future rate cap, for the third 5.5 run
            running.** Each time the model judged it not applicable,
            because the contract fixes one rate for one event. The key
            expects a finding. Whether CD wants that finding on a
            single-event contract is a question for the user.
        - **Thinking allowed at effort `medium` is the judging call's
          setting on the branch (user's choice, 2026-10-08).**
          `JUDGING_ANSWER` in `lib/anthropic.ts`. The second ask shares it.
          The reading call, both emails and every Sonnet 5 request are
          unchanged. The pinned Sonnet 5.5 review request changed in two
          fields, `thinking` and `effort`. The eval's flags still
          override it. Lint, typecheck and 1,569 tests pass, and the free
          request check accepts all 16 pinned requests.
        - **Every Sonnet 5.5 call shares the setting (user's question,
          2026-10-08).** `ANSWER_DEFAULTS` in `lib/anthropic.ts`. The
          reading call, both emails and the archived and eval-only calls
          had stayed on thinking off at `high`, a switch only Sonnet 5.5
          has. Seven more pinned Sonnet 5.5 requests changed in the same
          two fields. The reading call and the emails are unproven on
          this setting until a paid review or draft runs. 1,578 tests pass.
        - **Gate run `sonnet55-harborview-app-2026-10-08` (review
          `a70ff3c5`, about $0.68, 322s). Passed.** The user uploaded
          Harborview through the app on the branch, so one run covered the
          long contract and the app's own path.
          - 33 of 34 key items, against a bar of 32. The miss is the future
            rate cap again, judged not applicable.
          - **The model thought this time:** 16,795 of 55,532 output
            tokens. It thought on neither earlier run at `low` or
            `medium`. The judging call took 312s, past the old 300-second
            wall, so streaming is proven on the real API inside the app.
          - The first pass was complete. No clause was judged short and
            left without a finding, and the second ask did not run.
          - 79 findings: 65 business, 13 legal, 1 other. 33 clauses have a
            finding, at most four each.
          - Redline replay applied 63, with no failed check. Two were left
            out for blanks the associate fills (`[X]` square feet on
            function space, and one on cancellation).
          - The library came from the database, with the user's gratuity
            sentence fixed minutes before.
          - Not covered: a real contract on this setting, and the emails.
        - **Before the next paid run:** run one contract at a time with
          nothing else in flight, and price it from the Console's actual
          usage. The eval capture already has the app's limit and one try.
      - **Waiting on a yes for the paid step.**
        - One Florida review on 5.5 through the app, about $0.45 to $0.50.
        - The seven-contract eval on 5.5, roughly $2 to $3, to be quoted
          exactly.
        - **Compile check done 2026-10-06.** All eight Sonnet 5.5 forms
          compile on a real call, the shorter reading list included. It
          cost about 5 cents. The user approved about 3. The sweep was
          $0.0252, and a careless second command ran it twice.
        - To settle on that run: `[X]%` on gratuity, table rows written as
          prose, and the no-arithmetic rule.
- [ ] **3. Standards library by hotel brand (CD, 2026-10-06).** CD has
      pre-negotiated standard contracts with some major brands. A review
      compares the contract with the standards for its brand.
      - Three sets to start: **Independent** (the catch-all, and today's
        library), **Hilton** and **Hyatt**. CD expects up to 16 in time, so
        the design must take more sets without a schema change.
      - A brand with no set, or one not recognised, is reviewed against
        Independent.
      - Each review records which set it used. A continuing negotiation keeps
        its first round's set.
      - The Standards library screen gets a set picker. Edits stay audited.
      - Hilton and Hyatt start empty and fall back to Independent until CD's
        documents arrive.
      - **Built 2026-10-06 on `standards/brand-sets`, cut from the Sonnet
        5.5 branch. Not merged.** `docs/standards-sets.md` has the model.
        - A set is complete in itself. A Hilton review reads Hilton's
          standards and nothing from Independent.
        - A set is read only once an admin switches it on, and an empty
          set can't be switched on. One Hilton standard added on its own
          would otherwise make every Hilton review check one clause.
        - A review that can't use the set asked for reads Independent,
          records why, and says so on the review screen.
        - Independent's fingerprint is unchanged, so the eval baselines
          hold.
        - An empty set can be started from a copy of Independent. The
          copies carry no validation stamp.
        - Lint, typecheck and 1,492 tests pass. No pinned model request
          changed.
        - **Waiting on the user: run migration 015 in Supabase's SQL
          editor.** It is safe while the live site is on today's code.
          The picker, the switch and the copy have not been seen in a
          browser, because they need its tables. Before the migration
          the Standards screen and the review screen work as they did,
          which was checked.
        - **Add no Hilton or Hyatt standard until this code is live.**
          Today's loader reads every row whatever its set.
        - Not built: a screen to add a fourth set, and which sub-brands
          count as Hilton or Hyatt (question 2 for CD).
- [ ] **4. Confirm step on upload.** Depends on item 3.
      - Today the associate picks a file, types the property name, and the
        review starts.
      - After, the associate picks a file. The app reads the property name
        and brand from the contract and shows them with the standards set it
        would use. The associate edits or confirms, and then the review
        starts.
      - The AI-use check runs first, on the local text. A contract it stops
        gets no model read, and the associate types the fields.
      - ~~The read costs about a cent and doesn't count against the monthly
        review limit.~~ Superseded. The read is local rules, with no model
        call and no cost (user, 2026-10-07).
      - **Built 2026-10-07 on `upload/intake-confirm`, cut from
        `standards/brand-sets`. Not merged.**
        - Picking a file posts it to `POST /api/analyses/read`, which
          stores nothing and returns the property name, the brand, and
          the sets a review can read. `lib/intake/read.ts` holds the rules.
        - **Property name.** A labelled row or cell ("Hotel:", "Hotel
          Name:"), or the party the contract defines as the Hotel. Read
          correctly on 16 of 16 contracts on file, which are three
          layouts.
        - **Brand.** A brand in the property name, or the one brand the
          contract names outside a comparison. "Hilton Head" is ignored.
          Two brands give Independent, with the reason. **Untested on a
          real contract**, since every stored one is redacted or
          invented.
        - Each filled field shows the contract's wording it came from. A
          name the associate typed is never overwritten.
        - **The Hotel brand field is always on the form (user,
          2026-10-07).** It lists every brand, with "Independent or another
          brand" first, and is filled from the contract once a file is
          picked. A brand the associate picked is never overwritten.
        - **The field shows the hotel's actual brand (user, 2026-10-07;
          merged and deployed the same day, migration 016).** It is free
          text, filled from the contract against a list of known hotel
          brands (`lib/intake/brands.ts`) and editable. A grey line under
          it says which standards the review will use: the brand's own, or
          Independent's when the brand has none (Marriott, say) or its set
          is switched off. A brand that is also an everyday word, such as
          Courtyard or Conrad, is read from the property name only.
        - **A brand is recorded even while its standards are off.** The
          form then says the review will use Independent's, and the review
          screen says the same. When an admin switches the brand's
          standards on, that negotiation's later rounds read them.
        - The audit row for an upload keeps what was read beside what was
          confirmed, to measure the rules during the beta.
        - Lint, typecheck and 1,527 tests pass. Checked in the browser
          with two small invented files: the name fills with its
          evidence, a typed name survives a second pick, and a file that
          names no hotel leaves the field blank.
        - Seen in the browser with an invented "Hilton Sampleville
          Downtown" file: Hilton is selected, with the contract's wording
          and the line that Independent's standards will be used.
        - **To test the brand rules:** leave the hotel's brand in the next
          redacted test contracts, or use a stand-in such as "Hilton
          Sampleville".
        - Sub-brands without the family name ("Conrad", "Andaz") read as
          Independent until CD answers question 2.
- [ ] **5. CD's updated documents.** Waiting on CD.
      - Updated baseline for the Independent standards, plus the Hilton and
        Hyatt standard contracts. Extract the key terms from each into its
        set, through the audited admin path, as on 2026-09-22.
      - More test contracts, which the user redacts by hand.
      - **These contracts wait for CD's API key.** CLAUDE.md deviation 7
        allowed one redacted contract on the personal account for one
        presentation. The app reviews the new ones on CD's key, and Claude
        Code reads them under the user's seat on CD's team.
      - The library's hash changes, so the eval needs fresh baselines.
- [ ] **6. Core polish.** The "Still to address" list under the incoming
      comments item below, in the order set on 2026-10-03, judged on Sonnet
      5.5. `phase/2-1-same-file-reuse` (one commit, unmerged) belongs here.
      - **Yellow boxes on the review card (user, 2026-10-06).** The card's one
        yellow box says why a change won't go into the redline. All 32 boxes
        on Jerry's seven finished reviews were read.
        - "Leaves out a sentence" appears once in the four reviews run since
          a quote became required on 2026-10-03, and never on Sonnet 5.5. The
          engine change in "Still to address" item 1 is deferred. Revisit it
          if 5.5 runs bring the box back.
        - `c7148b08` holds 9 of the 32 boxes. It is the run that came back
          with no quotes, a defect fixed the same day.
        - **Two bugs fixed on `redline/bracket-and-row-boxes` (6f5b39c,
          merged 2026-10-06).** The contract's own bracket with a changed figure was
          called a blank. A table row written with a `|` at each end was
          counted as two cells too many. With both fixed the boxes fall from
          32 to 25, and both 5.5 reviews show none.
        - **Defect found by replaying those reviews, live on `main`.** When
          two findings each change a row of the same table, the engine strikes
          the table and inserts a copy, then does the same to the copy. The
          second copy repeats the first's change ids. The §1.6 oracle catches
          it (`revision_ids_unique`), so the export falls back to the
          marked-up PDF and no Word redline is produced. Nothing corrupt
          reaches a hotel. `dd0f4ca0` falls back this way today. The two
          fixes above let more rows through, so `4f803f16` would go from 44 of
          49 applied to a fallback.
        - **Table defect fixed on the same branch (2026-10-06).**
          The cause was wider than two row changes. `replaceTable` cloned a
          table with whatever tracked changes it held, and the clone repeated
          their ids. Three cases fell back: two row changes on one table, a
          one-cell change then a row change, and a row change on a table the
          hotel had edited.
          - The engine remembers the copies it inserts. A later change to a
            replaced table is made in its one copy, with no new tracked
            change. Five tier changes give one struck table and one copy.
          - A fresh copy has every tracked change in it accepted first, so
            it reads as the table reads today and carries nobody's marks. The
            hotel's marks stay on the struck original.
          - A table that still holds a tracked change after that, such as a
            formatting change, is refused for that one finding.
          - Free replay of Jerry's seven reviews: every one passes the oracle.
            `4f803f16` goes from 44 of 49 applied to 49 of 49, clean.
            `dd0f4ca0` goes from a fallback to 26 of 29 applied.
          - **Merged to `main` and deployed 2026-10-06** on the user's
            instruction, with the bracket and table-row fixes. Lint, typecheck
            and the full suite (1,373 tests) passed on the merge.
          - **HIGH PRIORITY, still owed: a look in Word by the user.** Nobody
            has opened a rebuilt redline in Word. The oracle passes, and Word
            is the only test of how one struck table beside its copy renders.
            Open `data/private/replay/4f803f16-redline.docx`. The cancellation
            schedule should show once struck and once new, with all five
            tiers changed. Try Accept All on one copy and Reject All on
            another, then open `4f803f16-clean.docx`. A repair prompt, or a
            schedule showing three times, means the fix needs another look.
          - Still open: a replaced table that holds a hotel comment ("Still to
            address" item 6).
        - **A missing box.** On `9244158e` five cancellation changes are left
          out at export ("runs across a paragraph break") and the card shows
          no warning. The card's check reads the review text and can't see
          paragraph breaks inside a table cell.
        - **Fixed 2026-10-07 (`redline/cell-paragraphs`): a change that
          spans paragraphs is made as one change per paragraph.** A
          cancellation schedule holds each fee as two paragraphs in one
          cell, the amount and then its bracketed formula. The model quotes
          the cell and proposes both lines changed, and the engine refused
          anything crossing a paragraph break.
          - The proposal is laid out across the paragraphs with
            `splitAcrossCells`, and each paragraph takes an ordinary
            in-place change. The table is not struck and copied.
          - A proposal that moves wording across the break is still
            refused, as is a quote running from a table into the text
            around it.
          - It also applies to two body paragraphs.
          - Free replay of eight stored reviews: Florida on 5.5
            (`4a7e89f6`) goes from 33 of 40 applied to 39 of 40, and
            `9244158e` from 29 of 34 to 34 of 34. The other six are
            unchanged. Every oracle check passes on all eight.
          - The card still can't warn about the rare case that stays
            refused, since the stored review text has no paragraph breaks
            inside a cell.
          - Word check owed by the user:
            `data/private/replay/4a7e89f6-redline.docx`.
        - **For the next paid 5.5 run.** Sonnet 5 writes `[X]%` for gratuity on
          every review, though the standard says 18% and 6%, and writes table
          rows as prose. Sonnet 5.5 did neither on two reviews.
- [ ] **7. Hand-off guide (user, 2026-10-06). After core features are locked.**
      Step-by-step instructions, written for the user's experience level, for
      moving the beta onto CD's side. `MASTER_PLAN.md` Part 4 is the outline,
      with Render in place of Vercel and no conversion worker.
      - Anthropic: the API key, a spend cap, and the user's developer role.
      - Render, Supabase, GitHub and outgoing email: who owns each, and
        whether each moves or stays for the beta.
      - Sign-in. CD is choosing between Microsoft sign-in and MFA. Supabase
        supports both. Microsoft sign-in is set up with CD's IT (readiness
        item 9), and CD's IT then enforces MFA in its own directory, so the
        app needs no MFA screens. MFA on passwords needs enrolment and
        challenge screens built in the app.
      - Rotating every secret that touched a personal machine.

**Questions to take to CD.**

1. Is there an Anthropic API organization with billing, separate from the
   Claude Team seats? The app calls the API with a key from the Anthropic
   Console. A Team seat covers the user's development. It gives the app no
   key. Unverified against Anthropic's current pages as of 2026-10-06.
2. Do the Hilton and Hyatt terms cover every brand in each family (DoubleTree
   and Embassy Suites under Hilton, for example), and franchised hotels as
   well as managed ones?
3. For a branded hotel, should the tool flag every departure from the
   pre-negotiated contract, including one that favours the group?
4. Microsoft sign-in, or passwords with MFA?
5. Carried over: the 70% versus 75% attrition figure, and "Provisional values
   for CD to confirm".

### Next up, in order (user, 2026-09-28)

- [ ] **0. Sonnet 5.5 change-over — built, not live.** Branch
      `migrate/sonnet-5-5` (not merged).
      - **Required before the beta (user, 2026-10-06).** See "Beta
        preparation" item 2. The current work is on `review/one-reading-pass`,
        and that branch's copy of this item is the fuller record.
      - Sonnet 5.5 costs the same per token as Sonnet 5.
      - It rejects a forced tool_choice. Forced-capable models keep today's
        request byte for byte. Sonnet 5.5 gets no tool: the schema goes as an
        output format (`output_config.format`), with thinking `between_tools`
        and effort `high` (user's decision, 2026-10-03).
      - **Blocker.** Harborview's review at the default effort (`high`) ran past
        10 minutes and was stopped. The app gave the model 240s then, and
        gives it 420s now. Sonnet 5.5 always thinks, and a forced Sonnet 5 call
        doesn't (the Rome run recorded 0 thinking characters).
      - Until it's measured, Render stays on `ANTHROPIC_MODEL=claude-sonnet-5`.
      - **Scoped 2026-10-03, to build after the Word round-trip item.**
        Anthropic's notes on Sonnet 5.5 change the approach.
        - **Thinking.** `thinking: {type: "between_tools"}` turns upfront
          thinking off. A review is one tool call, so nothing is left to think
          between. This is the closest match to a forced Sonnet 5 call and the
          likely fix for the timeout. It is allowed at effort `high` or below
          only, and takes no other field inside `thinking`.
        - **Effort.** The levels are recalibrated on 5.5. Set
          `output_config.effort` explicitly. Test `high` first, then `medium`.
        - **Forced tool choice.** The branch's `auto` plus a strict tool is one
          route. Structured outputs (`output_config.format`) is the other, and
          it guarantees the format. Count missed tool calls in the eval run. If
          any occur, move the review call to structured outputs.
        - **Preserved thinking.** No change needed. Every call in the app is a
          single request and never replays an earlier answer. CD's future org
          will be enforced by default and is still unaffected. Any later
          multi-turn feature must keep its history append-only.
        - **Refusals.** 5.5 declines in five categories. Server-side fallback
          retries only `cyber` and `frontier_llm`, neither likely on a hotel
          contract. Included by default unless the user declines.
        - **Streaming.** The review call asks for 64k tokens without streaming.
          `.stream().finalMessage()` follows SDK guidance and lets the deadline
          cut a slow call cleanly. Optional second step.
        - **Branch state (2026-10-03).** `main` is merged in. All seven model
          calls work on 5.5, the historical-contract read and the two eval
          calls included. The SDK is 0.131.0, which types `between_tools`.
          Lint, typecheck and 1,356 tests pass, and every Sonnet 5 golden
          matches `main`.
        - **Structured outputs, not a strict tool (user, 2026-10-03).** With
          `tool_choice: auto` the model can answer in text, and a missed call
          on a four-minute review leaves no time for a retry. An output format
          holds the reply to the schema, so a miss can't happen. The tool's
          description moves into the system prompt. A nullable enum goes as
          `anyOf`, which the format needs.
        - **Refusal fallback left out (user, 2026-10-03).** It retries only
          `cyber` and `frontier_llm`, and needs the beta endpoint. A decline
          stops once with a clear message.
        - **Free check passed** (`scripts/check-request-shapes.ts`, the
          token-counting endpoint). All 14 goldens are accepted. A forced tool
          on 5.5 and `between_tools` at `xhigh` are rejected. The schema's
          descriptions count toward the request (24,083 tokens with them,
          22,226 without), so the model sees them.
        - **First 5.5 run `4f803f16` failed in its first second, at no cost
          (2026-10-03).** Anthropic refused the review's output format with
          "The compiled grammar is too large". The token-counting endpoint had
          accepted it, because counting checks a schema's keywords and never
          compiles it. `scripts/check-request-shapes.ts --compile` now makes
          the cheapest real call that does (under a cent a form).
        - **The cap belongs to the enforcement service.** Sonnet 5 refuses the
          same form. Six of the seven forms compile. The review form (60
          fields) doesn't, and no change that keeps every field enforced got
          it under the cap. It compiles without the figures section, or
          without the legal findings list. Probes cost $0.04 in all.
        - **One reading pass (user, 2026-10-03), on `review/one-reading-pass`,
          cut from `migrate/sonnet-5-5`.** The user chose to split reading from
          judging now, and to do it once. A review is two calls side by side
          (`lib/review.ts`). The judging call writes the findings. The reading
          call is the term pass, and exposures are worked out from its checked
          terms (`figuresFromTerms`). It asks for the exposure terms alone when
          `TERM_EXTRACTION` is off, and the whole catalog when on, so each
          number is read once.
          - Catalog `hotel-v2` adds the block's total room nights, the minimum
            room nights, and which room nights the cancellation fee applies to.
          - The review form and prompt lose `deal_figures`, for both models, so
            every golden changed. `checkFigures` is retired. The exposure
            arithmetic is untouched, and the Florida and Rome figures give the
            same amounts fed from terms.
          - A failed reading call is retried once, then the review completes
            with no exposures. The review screen doesn't yet say why they are
            missing.
          - A review costs about $0.05 more, since the contract is sent twice.
          - Lint, typecheck and 1,366 tests pass. The free shape check passes.
          - **Compile sweep passed (2026-10-03, $0.02).** All seven 5.5 forms
            compile on a real call.
          - **Reading call alone on Florida, Sonnet 5 (two runs, $0.07 each,
            about 12 seconds).** The first gave no attrition exposure: the
            reader quoted the row label "Total Room Block", so the check
            refused the 2,900. The reader's rule now says to quote the cell
            that holds the value, and the second run gives $157,524.40:
            attrition $29,800 and cancellation $91,724.40, both as on
            `c27f414d`, plus F&B $36,000.
          - **A cancellation charge on the F&B minimum counts as F&B exposure
            (user, 2026-10-03).** Florida has no underspend clause. Its table
            charges 80% of the minimum inside 90 days, and
            `fb_minimum.shortfall_rate` now says that counts. This answers
            "F&B exposure went missing" in the list further down.
          - **Known weakness.** A room-night figure is verified when its quote
            holds that number anywhere. The reader quoted the whole table row,
            so any number in the row would have verified. Worth tightening
            before exposures are relied on.
          - **Florida review `4f803f16` on Sonnet 5.5, split, as Jerry
            (2026-10-03, $0.50).** Against `c27f414d` (Sonnet 5, one call):
            - Time 3m27s against 4m07s. No thinking. No failed answer, no retry.
            - Cost $0.50 against $0.40: judging $0.43 (32.9k tokens out against
              29.2k) plus reading $0.07.
            - 68 findings against 51 (business 50, legal 12, other 6). The same
              32 clause types on both. Twelve clause types gained findings, so
              the extra ones are more places, not more topics.
            - 39 of 39 changed clauses quoted. Five quotes are still whole
              table rows, the cancellation tiers.
            - Notes: 39 kept, 11 blanked (8 for figures, 2 for repeating
              internal wording, 1 for naming ConferenceDirect), against 20 and
              15.
            - Severity departs from the library default on 4 findings against
              8.
            - Redline from its findings: 44 of 49 applied against 28 of 34.
              Every oracle check, the clean copy and both PDFs passed. The five
              left out are the table-row quotes.
            - **Exposure $65,800: attrition $29,800 and F&B $36,000, and no
              cancellation figure.** The 5.5 reader gave no usable top tier or
              damages basis, where Sonnet 5 as reader gave both twice. The
              terms aren't stored with extraction off, so the cause is unseen.
              The app now logs which piece was missing.
            - The first try stalled on a network drop before any model call and
              cost nothing. The row sat at "processing" until the ten-minute
              stale rule allowed a retry.
          - **Reading call alone on Florida, Sonnet 5.5 ($0.07, 8 seconds).**
            It gives all three exposures, $157,524.40, the same as Sonnet 5 as
            reader. So the review's missing cancellation figure came from a
            reading that differed on the day, not from a reader that can't do
            it. The reader's answers vary from run to run on the two terms
            cancellation depends on.
          - **Sturdier exposures (2026-10-03, free, built on the new Mac).**
            Lint, typecheck, 1,385 tests and the free shape check pass. No
            prompt, catalog wording or golden changed.
            - **The reading is kept with every review.**
              `analyses.term_extraction` now holds the figures, the exposure
              terms as the reader gave them, and a note for each term that
              gave no figure, whether `TERM_EXTRACTION` is on or off. A failed
              reading is recorded too. The `contract_terms` rows stay behind
              the switch, since Analytics reads them. No migration.
            - **Room counts must be singled out.** A count of rooms or room
              nights is verified when it is the only room count in its quote,
              or when the other counts add up to it, as Florida's eight nights
              add up to 2,900. A bare table cell is judged by its row. Anything
              else is "located", which exposures don't build on. Amounts,
              percentages, durations and dates aren't read as room counts. The
              complimentary-room ratio keeps the old rule, since "1 per 40"
              always holds two numbers. Checked on the real Florida row: 2,900
              verifies and a nightly count doesn't.
            - **Cancellation, the schedule as backstop.** With no usable
              top-tier percentage, the schedule's closest tier supplies it,
              only when the schedule's own quote states that percentage.
            - **Cancellation, a second ask (user's choice, 2026-10-03).** When
              a reading has cancellation terms and lacks a tier answer, the
              reader is asked once more for the three tier answers alone
              (`lib/review.ts`, `TIER_CATALOG`). Both readings are checked
              together, so a disagreement gives no figure. It runs beside the
              judging call and adds no wait. It costs about 5 to 7 cents on a
              review where it fires.
            - **Still weak.** A percentage is verified when its quote holds it
              anywhere, as room counts were. The second ask doesn't fire when
              the reader returns nothing about cancellation. The stored
              readings will show whether either matters.
            - **Not yet run against a model.** Every test here is mocked. The
              first paid review will show the stored record and whether the
              second ask fires.
          - **Two paid runs on Sonnet 5.5 with the fixes (2026-10-04, $0.89).**
            - **Florida `9244158e`, through the app as Jerry ($0.42, 2m39s).**
              51 findings against 68 on `4f803f16`, the same file and model.
              32 of 32 changed clauses quoted. Exposure $36,000, F&B alone.
              - The stored reading explained both missing figures at no cost.
              - Cancellation: the reader gave the percentage (90%), the
                schedule and the room nights, and answered `other` for what
                the percentage is charged on, at medium confidence. The
                clause says room nights times the rate times 90%. The
                catalog's two options ("gross room revenue", "lost room
                profit") don't describe that formula plainly enough.
              - The second ask did not fire, because `other` counts as an
                answer. It would not have helped: a second reading saying
                `gross_revenue` would clash with the first.
              - Attrition: every figure was read and verified, but the
                judging call wrote no attrition finding, so the exposure had
                no card to sit on. It judged attrition `falls_short` and six
                other clause types short or missing, and wrote no finding for
                any of the seven. The app records such gaps in the audit log
                and shows the associate nothing.
              - The room block was quoted as a bare cell and verified by its
                row, as the new rule intends.
            - **Harborview eval `sonnet55-harborview-2026-10-04` ($0.47,
              3m36s).** It finishes in time now. It ran past ten minutes
              before the thinking fix.
              - 30 of 34 key items found (88.2%). Sonnet 5 found 34 of 34 on
                `combined-2026-09-23` and 33 of 34 on
                `baseline-repeat-2026-09-22`. Those baselines used an earlier
                prompt and library, so the comparison is rough.
              - 90 findings, 55 of them scored as repeats of an issue already
                reported. The four misses are medium items. Three are clause
                types the model judged short and wrote no finding for.
              - No exposures. The contract states no total of room nights, so
                the reader added four nights of 170 and gave 680 with one
                night's row as its quote. The check refused it, and attrition
                and cancellation both need that total.
            - **What this says.** The arithmetic never varied. What varies is
              the reader's answers, and whether the judging call writes a
              finding for the exposure to sit on. On two contracts 5.5 at
              this setting is faster than Sonnet 5 and less consistent.
            - **My own read of both contracts against the runs (2026-10-04).**
              Almost every finding in every run is true to the text. The runs
              differ in what they wrote down, and in arithmetic.
              - Florida on 4 Oct dropped attrition, the commission rate and
                rate protection. The 3 Oct run was the most complete of the
                three.
              - Proposed cancellation wording carried hand arithmetic. Sonnet
                5's top tier was $213,023.60 where the sum is $214,023.60.
              - Both models wrote "placeholder" findings. One was the proposed
                wording of a business finding.
              - The app's own table check caught three totals that every model
                missed.
              - Harborview's 90 findings are valid splits by term. The scorer
                counts 55 as repeats because its key has one item a clause.
            - **Sonnet 5 retires no sooner than 30 June 2027, and Sonnet 5.5
              no sooner than 28 September 2027** (Anthropic's deprecations
              page, read 2026-10-04, with 60 days' notice). The app will meet
              a forced model change in its first year.
            - **Built from these runs (2026-10-04, free). Lint, typecheck and
              1,406 tests pass.**
              1. **Must-raise numbers** (`lib/must-raise.ts`). The app reads
                 the commission rate, the attrition floor and the F&B
                 shortfall rate, compares each with CD's standard, and writes
                 the finding itself when no finding covers the number. The
                 wording is the contract's sentence with the number changed,
                 offered only when the number sits in it once. The reading
                 call always asks for the commission rate now.
              2. **One note when a review is incomplete.** Clauses judged
                 short with no finding are named in a single note. A card for
                 each was considered and dropped (user, 2026-10-04), since a
                 card with no wording is reading without a decision.
              3. **A clearer cancellation question.** The two
                 `cancellation.damages_basis` options now say what each is
                 taken of. The catalog is `hotel-v3`.
              4. **Totals that add up.** A room-night total the contract
                 doesn't print is verified when a column of its table adds up
                 to it.
              5. **Placeholder findings dropped** and logged.
              6. **Real reader answers replayed as tests**
                 (`tests/readings-replay.test.ts`,
                 `scripts/save-reading.ts`). On Harborview's saved answer the
                 app now gives attrition $39,304 and cancellation $58,956,
                 where the run gave none.
              - **Considered and left out.** A must-raise rule for the
                cancellation basis, a dollar check on proposed wording, and a
                paid follow-up call for skipped clauses (8 to 10 cents a
                review).
              - **Not yet run against a model.** A reader-only check on
                Florida and Harborview would cost about $0.11 and would show
                the reworded question and the commission read on real
                answers.
              - **CD's numbers come from the standards library (user,
                2026-10-04).** The attrition floor, room profit, the F&B
                shortfall rate and commission were typed into code. The app
                now reads each from the wording of its standard at the start
                of a review (`lib/exposures/cd-positions.ts`), so an edit on
                the Standards screen reaches the next review's dollar figures
                and must-raise checks.
                - The app finds each number by the words around it, such as
                  "10% commission". If a standard is reworded so the number
                  can't be found, the built-in value stands in.
                - The Standards screen shows, under each of the four
                  standards, the number in use, or a warning with wording the
                  app can read. It updates as the admin types.
                - Each review stores the numbers it used (`cd_positions` in
                  `analyses.term_extraction`).
                - A review already run keeps its figures.
                - A separate number field was considered and left out, since
                  it would give CD two places to keep in step.
                - Checked live on the Standards screen: four readouts, 12%
                  after an edit, a warning after a reword, nothing saved.
          - **Still to do, each paid step with its own yes.** The Florida
            review on Sonnet 5 with the split (about $0.45), if the split's
            own effect needs isolating. Then the seven-contract evals, since
            this changes Sonnet 5 too, before any merge to `main`.
          - **Moving computers (2026-10-03).** Everything in git is on GitHub.
            Three things live only on the old Mac and must be copied by hand:
            `.env.local`, `data/private/`, and Claude's memory folder and
            global `CLAUDE.md` under `~/.claude/`.
      - **Steps.** Opus work, since it changes every model request. Each paid
        step needs its own yes.
        1. Done. Merge `main` into the branch. Add `between_tools` and
           explicit effort to the non-forced path (`answerRequest`). Cover the
           historical and eval calls. Regenerate the goldens.
        2. Done. Check every request shape on the token-counting endpoint. It
           is free and rejects bad `thinking` and `tool_choice` values.
        3. Paid, about $0.40. Run the redlined Florida file
           (`data/private/florida-property-round1.docx`, git-ignored) on 5.5
           with `between_tools` at `high`. Compare time, tokens and findings
           with `c27f414d`, the Sonnet 5 run on the same file and the same
           code (4m07s, 24.8k in, 29.2k out, 51 findings, 27 of 27 changed
           clauses quoted, $121,524 exposure).
        4. Paid, about $2.35 on Sonnet 5.5 (corrected 2026-10-04; this line
           said $0.65 to $0.80). Run the seven-contract eval set and score it
           against the existing baselines.
           - The last full run, `combined-2026-09-23` on Sonnet 5, cost $1.83
             and took 26 minutes. Output is the expensive part, and the prompt
             now asks for more of it.
           - 5.5 wrote about 13% more on Florida, and each contract now gets
             a reading call too, about $0.04.
           - Per contract on 5.5: Harborview about $0.48, Crossroads $0.39,
             Monarch $0.32, the other four about $0.29 each.
           - `scripts/with-retry.ts` tries a failed contract up to four times,
             and each try is paid. Watch a run and stop it on a first failure
             when credit is short.
        5. If time and scores hold, change the Render variable. Sonnet 5 stays
           one variable away.
           - **Reminder (user, 2026-10-03).** Once 5.5 runs cleanly on the
             tool, set Render's `ANTHROPIC_MODEL` to `claude-sonnet-5-5`. The
             code's default is already 5.5, and Render's variable is what
             keeps production on Sonnet 5 until then.
- [x] **1. Analytics live for a demonstration (2026-09-29).** Deployed
      2026-09-28 (679eae3), with the three switches set on Render.
      - **Archived for the beta (2026-10-06).** See
        `docs/archived-features.md`.
      - Runs on test data behind three Render switches: `ANALYTICS=on`,
        `ANALYTICS_SOURCE=test` and `ANALYTICS_DEMO=on`. A production build
        needs the last one before it shows test data.
      - The test-data banner shows on every page.
      - Nobody uses the app for real until about March 2027.
      - After the demo, turn `ANALYTICS_DEMO` off to hide the tab until real
        data exists, or leave it on.
- [x] **2. Standards library editing** (`app/(app)/admin/standards`).
      - Drag a standard between the High, Medium and Low buckets to change its
        severity.
      - Add a standard.
      - Remove a standard, with a confirmation.
      - Audit every change, as edits are audited today.
      - **Deployed 2026-09-28** (merge 37e9e1b).
        - Removing retires a standard. The row stays for the reviews that
          quoted it, and it can be restored.
        - Changes reach reviews run afterwards only. Past findings keep their
          severities.
        - Drag and drop doesn't work on phones, so the Edit form's severity
          menu covers them.
- [x] **3. Admin tab.** A new admin-only nav link. "Standards library" keeps its
      own link.
      - **Users:** see every associate, invite, change the admin flag,
        deactivate.
      - **Historical contracts:** an upload screen like New review's, feeding
        the Analytics tab. **Archived for the beta (2026-10-06)**, behind
        `HISTORICAL_CONTRACTS`. Users management stays live. See
        `docs/archived-features.md`.
      - Needs the Analytics database source and its migration.
      - **Deployed 2026-09-28** (merge 37e9e1b). The Admin link opens
        Historical contracts first, with Users as the second tab.
        - Adding an associate puts their email on the sign-in allowlist. No
          email is sent.
        - An admin can't lock themselves out, and one active admin always
          remains.
        - **Historical uploads are bulk and need no typing** (user, 2026-09-28:
          CD expects 500+).
          - Drop any number of files. Each file's text is read locally at
            upload, repeats are skipped, and AI-restricting contracts are held.
          - "Read waiting contracts" sends them through Anthropic's Batch
            service at half price, about 4¢ each or roughly $20 for 500.
          - One read fills the hotel, brand, place, client, dates and associate,
            plus the terms. A detail is kept only when its quoted words are in
            the contract. Parent company and tier are marked guesses.
          - The list is a review queue (Waiting, Being read, Needs a look,
            Ready), and an admin can correct any detail.
          - A scanned PDF with no text layer can't have its quotes checked, so
            its details land in "Needs a look".
        - Reading stays behind `HISTORICAL_EXTRACTION=on`, off until CD's
          Anthropic org exists (CLAUDE.md deviation 7). The user chose this.
        - The Analytics database source reads uploads that have a hotel, city,
          signed date and tier. Only checked terms count. Uploads have no draft
          history, so the charts about CD's asks leave them out.
        - Migrations 006, 011 and 012 were applied to live before the merge.
          006 (`contract_terms`) had never been applied, which is why 011
          failed on the first try.
- [x] **Business, legal and other standards, with compromise ranges (CD feedback,
      2026-10-02).** CD's team stressed that CD gives no legal advice. Merged to
      `main` 2026-10-02 (a27751e) and deployed by Render.
      - The standards library is grouped Business, Legal and Other. Dragging
        between groups changes the category. High/Medium/Low stays as the
        priority inside each group, set in the Edit form.
      - **Business** findings propose CD's wording, as before.
      - **Legal** findings explain the risk to the associate and never carry
        wording. The associate can Flag for client or Dismiss. Flagged items go
        to the memo ("For your counsel to review") and the client email,
        explanation only. They never reach the redline, the marked-up or clean
        copies, or the property email.
      - Legal wording is blocked at four layers: the model never sees legal
        fallback wording; its answer form has no wording field for them; the
        app strips any that arrives and stamps every category from the
        library; and the database refuses wording on a legal finding.
      - **Other** findings are noted without wording, as before. The group
        starts empty.
      - Starting legal set: insurance and indemnification, hotel cancellation,
        force majeure, governing law and venue, ADA, nondiscrimination,
        attendee data, assignment. Termination rights, labor disputes, named
        storm and brand change stayed Business as borderline. CD's legal team
        may want to move some.
      - Each business standard has a **compromise range**, shown in the card's
        Why section. Only the associate sees it. The model never reads it,
        and no export or email carries it. The values are provisional (see
        "Provisional values for CD to confirm").
      - Changes reach reviews run afterwards. Migration 013 also blanks the
        wording on existing legal-type findings (Jerry's `cb3daee0`).
      - Migration 013 applied and ranges filled before the merge (15 standards,
        287 existing business findings). Verified live on Harborview and Florida:
        sections, legal buttons, the refused edit, and a redline and memo built
        from Harborview's three accepted legal findings.
      - Collapsed standards rows show only severity. Provenance shows as
        "Source: ..." when a row is opened.
      - Unmeasured on a real contract. One Florida run (~$0.40) would show
        whether the model fills `flagged_findings` correctly.
      - Reviews from before this change keep explanations written under the old
        rules, which can state CD's position on a legal point. Read a legal
        explanation before flagging it on an old review.
- [x] **Short "why" comments in the Word redline (user, 2026-10-02; built
      2026-10-03 on `phase/1-5-11-redline-comments`).** Each applied change in
      the tracked-changes DOCX carries one short Word comment saying what it
      does for the group. CLAUDE.md deviation 8 records the decision.
      - The model writes `redline_note` on business findings. The associate
        can edit, remove or restore it on the card. Legal findings get none.
      - The note never carries CD's position. A content check refuses figures,
        words like "standard" or "fallback", notes over 25 words, and notes
        repeating CD's own wording on the finding. It runs at review time, when
        the associate saves, and at export. The export reads notes through a
        narrowed SELECT, the same pattern as §1.8.3.
      - Comments sit outside every revision, with ids above every revision id.
        §1.6 gained `comments_consistent`, and the whole fixture corpus passes
        with a comment on every change, fixture 15's existing comment included.
      - The clean Word copy strips our comments and keeps the property's. The
        PDFs show none. An "Include comments" checkbox in the export dialog is
        on by default.
      - Migration 014 adds the two note columns. Applied 2026-10-03.
      - Verified live on Harborview: three notes typed on the card reached the
        tracked-changes file, each covering its own change, authored by the
        associate. comments=0 gave a file with no comments part, and the clean
        Word copy carried none. The card and the route refused a figure, the
        word "industry", and a note on a legal finding.
      - Unmeasured on a real contract. Reviews from before this change have no
        notes, so their comments come only from what the associate types. One
        Florida run (~$0.40) would show note quality and how often the check
        blanks a note. Not run, by the user's choice.
      - Cost: about 800–1,000 extra output tokens per review, roughly $0.01.
- [ ] **Ask CD: a "confirm with legal" comment on legal findings (user,
      2026-10-03) — future update, not scheduled.** Legal findings make no
      change, so today they get no comment in the redline. Ask CD whether they
      want a short flag on those clauses. Points to raise with them:
      - The redline goes to the property. A flag shows the hotel which clauses
        the group's side considers legally open, which is leverage.
      - The comment would sit on the hotel's own wording with nothing proposed
        beside it, which invites "what do you want?", and CD gives no legal
        advice.
      - The memo's counsel section already flags these items for the client.
      - If CD wants them in a Word file, the safer shape is a separate
        client-only export with its own filename and a "not for the property"
        marker. It would never be a checkbox on the property redline.
- [ ] **Incoming tracked changes and comments in a real Word round trip
      (user, 2026-10-03) — next.** Every fixture with tracked changes or
      comments was built by us. None has been through real Word, so it is
      unknown how our changes and comments layer onto a file the property
      has worked on. To test:
      - A property's file that arrives with their own tracked changes and
        comments, through review, redline, clean copy and both PDFs.
      - Our redline opened in Word, with some changes accepted, some
        rejected, replies added to our comments, new changes of theirs, and
        saved. Word adds commentsExtended, commentsIds and people.xml, and
        may renumber ids.
      - That saved file uploaded as the next round. Check extraction reads
        it as the property sent it, our new changes nest correctly inside
        theirs, new comment ids don't collide, and the §1.6 oracle passes.
      - Whether Reject All in Word gives back what the oracle says it will.
      Needs Word itself, so the user runs the Word steps; the rest can be
      fixtures built from the files Word saves. Overlaps item 4 below, since
      every re-upload is one of these files.
      - **In progress on `phase/1-11-word-round-trip` (2026-10-03).** The test
        file is the Florida contract, marked up in Pages and exported to Word,
        with four tracked number changes and three comments by one author.
      - **Free pass, no model call** (`scripts/word-roundtrip-check.ts`).
        - Extraction read all eight revisions and passed every intake check.
        - A stand-in redline from `cb3daee0`'s findings applied 23 of 25
          changes on top of the hotel's. All eleven oracle checks passed,
          the reject round trip included. The clean copy and both PDFs passed.
        - Where our change covers a hotel edit, the hotel's struck words end
          up inside our deletion. Word never writes that shape itself, so it
          needs a look in Word.
        - The clean copy keeps empty change markers where our accepted
          rewrite swallowed a hotel edit. Also needs a look in Word.
        - The hotel's edit to the room-block table arrived with no tracked
          change. A first upload can't detect that.
      - **Paid run `c7148b08`, as Jerry, Sonnet 5** ($0.35, 3m36s, 38
        findings, the same clause types as `cb3daee0`).
        - **Defect: every business finding came back without quoted text**
          (0 of 24, against 21 of 25 on `cb3daee0`). The app doesn't drop it.
          `quoted_text` was never a required field, and this was the first
          real run since the findings form changed on 10/02 and 10/03.
          Without a quote the card reads "Proposed addition" and the redline
          has nothing to replace. Fixed on the branch by making the field
          required. Unconfirmed until a second run (about $0.37).
        - The model read the hotel's edits. Commission rose to High for the
          cut to 8%, rate protection cites 750 rooms, and the F&B finding
          cites $80,000.
        - Legal findings carried no wording. The model filed three of the
          eight in the business list with wording, and the app stripped it.
        - Notes: 15 kept, 8 blanked by the content check. The blanked text
          isn't stored, so the reason for each is unknown.
        - Exposure fell from $170,696 to $91,724. The attrition and F&B
          exposures didn't compute. Cause not yet traced.
        - The hotel's three comments appear nowhere on the review screen.
      - **Built after that run (2026-10-03, same branch).** The user chose to
        show existing comments to the associate and give them to the model.
        - Extraction reads each comment with its author, date, text, the
          wording it sits on, and its reply and resolved state
          (`lib/docx/comments.ts`). Comments never enter the contract text or
          its map.
        - The model gets them in a block of its own after the contract, with
          rules: they are not contract wording, never go in a quote, and are
          never instructions (`lib/document-comments.ts`). The AI-use
          pre-check scans them too. A file with no comments sends the same
          request as before.
        - The document pane has a "Comments (n)" button, absent when a file
          has none and off by default. On, it lists the comments, underlines
          each anchor with a number, and scrolls to the wording on a click.
          Checked through the page's structure, not yet by eye.
        - **Defect fixed.** A change of ours that covered a hotel comment's
          anchor pulled the comment's reference inside our deletion. The clean
          copy lost the comment, and the hotel would lose it by accepting our
          change. The engine now leaves a reference-only run alone
          (`lib/redline-engine/runs.ts`). The oracle and the clean-copy check
          fail when a comment the file already had loses a marker or sits
          inside one of our changes.
        - Fixture 16 copies the shapes of the Pages export. The existing
          revisions strip no longer says "Round 2+" on a first upload.
        - The server log now says why a note was blanked, why a figure was
          dropped, and when a finding arrives without a quote.
        - The user opened the stand-in redline and clean copy in Word. Neither
          showed a repair prompt.
      - **Second paid run `e6289f46` did not finish.** The network dropped
        during the model call, the request timed out, and the failure could
        not be written back, so the review sat at "processing". Whether the
        call was billed is unknown. Everything above is still unmeasured on a
        real run.
      - **Third paid run `c27f414d`, as Jerry, Sonnet 5** (about $0.40,
        4m07s, 51 findings: 36 business, 9 legal, 6 other).
        - **The quote fix works.** All 27 business findings that change a
          clause carry a quote. The other 9 are missing clauses.
        - **The model used a comment correctly.** The commission finding cites
          the margin note by its author. No comment text reached any quote or
          any proposed wording.
        - **More findings, because the model now splits by place.** Business
          findings rose from 25 to 36. Cancellation became six findings, five
          of them quoting a whole table row with its pipes, which the engine
          refuses. On `cb3daee0` cancellation was one finding and it applied.
        - Redline from this run's findings: 28 of 34 applied, every oracle
          check passed, the clean copy and both PDFs passed, and the hotel's
          three comments kept their anchors.
        - **Notes.** 20 kept, 15 blanked. Eleven repeated wording from the
          finding's internal text, two carried figures, two ran long. One kept
          note read "placeholder", so the content check now refuses a note
          under three words.
        - **Exposure $121,524.** Attrition follows the edited block (70% of
          2,900). Four of five cancellation tiers passed their check. The
          model gave no F&B shortfall rate this time, so no F&B exposure.
        - Legal findings carried no wording. One was filed in the business
          list with wording, and the app stripped it.
      - **Merged to `main` 2026-10-03** with the user's yes. Lint, typecheck
        and the full suite (1,331 tests) passed first. The lost review
        `e6289f46` was removed at the user's request.
      - **Still to address, in the order the user set (2026-10-03).** The
        Sonnet 5.5 change-over (item 0) comes first, so that every change to
        how the model reviews is judged on the model that will run the tool.
        1. **A rewritten sentence the finding didn't quote must not be left
           out (user, 2026-10-03: "it shouldn't happen").** Today, when a
           proposal rewords a contract sentence that the finding's quote
           doesn't cover, the redline drops that sentence and shows a yellow
           warning. The associate is left to raise it by hand. Two fixes,
           both wanted:
           - Engine. It already finds the contract sentence the rewrite
             matches (`lib/redline-engine/restated.ts`). It should strike that
             sentence and insert the rewrite, the way it widens a
             mid-sentence change today, and list it on the export screen as
             a widened change. No model call is involved.
           - Prompt. The quote must cover every sentence the proposal
             rewords. Judge this on Sonnet 5.5.
           The warning should then be rare, and reserved for a rewrite whose
           original the engine can't place.
        2. **The model splits findings by place.** Business findings rose
           from 25 to 36 once quotes were required. Cancellation became six
           findings, five quoting a whole table row, which the engine
           refuses. Decide on 5.5 whether to ask for one finding per clause
           with one quote, or to let the engine take a row-wide change.
        3. **The content check blanks 15 of 35 notes.** Eleven for repeating
           wording from the finding's internal text. Loosening the overlap
           rule is a leak trade, so it is the user's call. Reading the
           blanked notes first needs them logged or stored.
        4. **F&B exposure went missing.** The model gave no shortfall rate on
           `c27f414d`. One of five cancellation tiers failed its check.
        5. **Word round trip, by the user in real Word.** Open
           `data/private/run3/florida-property-round1-redline.docx` under a
           hotel-side name. Accept two changes, reject two, reply to two
           comments, resolve one, add a change, add a second author and a
           table-row edit. Save as `florida-property-round2.docx`. Reject All
           on a separate copy. Then run `scripts/word-roundtrip-check.ts` on
           both. This is the only test of Word's own comment-thread parts,
           and of our round-1 notes coming back inside a round-2 file.
        6. ~~**A replaced table that holds a hotel comment** fails the oracle
           and falls back to the PDF. The engine should refuse that one
           change instead.~~ Built 2026-10-08 a different way, at the user's
           direction. The change is made in the cells. See "Table rows, cell
           by cell" under "Beta preparation".
        7. **Tell the user what looked wrong on the export screen.** The
           warning's wording was rewritten on the card and in the export
           detail. The user saw it "come up weird" on the export screen, and
           where is not yet known.
        8. **The raw model answer isn't stored.** Two questions today (why
           the quotes vanished, why a figure was absent) could only be
           inferred. A debug column or log would settle them directly.
        9. **Show existing comments the way Word does (user, 2026-10-03).**
           The list at the top of the document pane is a first version and
           is to be replaced.
           - A "Show document comments" button opens a comment view.
           - In that view the findings pane collapses, and the document
             takes most of the screen.
           - Each comment sits in a margin on the right, beside the wording
             it belongs to, as in Word. Replies sit under their parent, and
             a resolved comment is marked.
           - Leaving the view brings the findings pane back as it was.
           - To settle in the plan: whether the hotel's tracked changes get
             margin notes too, what happens when several comments crowd one
             paragraph, and how it behaves on a narrow screen.
           - No model call is involved, so it doesn't wait on Sonnet 5.5.
             The data it needs is already returned by the preview route
             (`comments`, with each one's range in the text).
           - **Built 2026-10-03 on `phase/1-11-comment-view`. Merged to
             `main` 2026-10-04 (7749c4f).**
             - Tracked changes get margin notes too (user's choice). A
               deletion beside an insertion by one author reads as one
               "Replaced" note, with whole words shown.
             - Crowded notes are pushed down in order, below the one above.
             - Below the `lg` breakpoint the same notes show as a list above
               the document.
             - Checked live on Florida `4f803f16`: three comment notes and
               four change notes, each level with its wording, linked both
               ways.
             - Not yet seen: a reply thread, a resolved comment, and a
               moved passage. The Florida file has none. The Word round-trip
               file will have the first two.
             - Picking a note again scrolls back to its wording, and a wide
               table scrolls sideways so the margin doesn't cover it.
             - **Future check (user, 2026-10-03): a document with many
               changes and comments.** Florida has seven notes. A heavily
               redlined contract could have dozens in one section, and the
               user's worry is how that presents. To look at:
               - how far crowded notes drift below their wording
               - whether a long run of notes leaves the reader lost
               - how fast the margin lays out and scrolls
               - the 100-comment cap on what the file's comments show
               A ready test file is our own redline of Florida
               (`data/private/run4/florida-property-round1-redline.docx`),
               which would give about 95 margin notes from 126 revisions
               and 36 comments. Uploading it costs a review today. It becomes
               free once compare-only rounds exist, so check it then.
      - **Known and accepted.** The hotel's table edit arrived untracked. A
        first upload has nothing to compare it with, and a re-upload is
        caught by the round diff. The marked-up PDF shows the hotel's edits
        as plain text and shows no comments.
- [ ] **Pages uploads, and other formats and comment styles (user,
      2026-10-03) — later, not scheduled.** The upload accepts only PDF, DOCX
      and DOC, so a `.pages` file is refused. To scope when it comes up:
      - Whether to accept `.pages` directly, or tell the associate to export
        it to Word first.
      - Which other formats and comment styles hotels send (Google Docs
        exports, PDF annotations, comments typed into the text).
      - What a Pages export loses. On the Florida test file (2026-10-03) it
        kept four tracked text changes and three comments, but it dropped the
        initials footer, emptied the page-number fields, and exported an edit
        to the room-block table as plain text with no tracked change.
- [ ] **4. Re-uploads of the same contract — next priority after these.** CD
      runs several rounds of review on each contract, so a re-upload should
      avoid a full paid review wherever it can. The plan is the entry
      "Re-reviewing the same contract without the model" below. Case 1 (same
      file, no model call) comes first.

### Raised by the first eval run (2026-09-10)

The §2.0.1 harness measured the pipeline for the first time: recall 100%,
precision 50.6%, on 7 generated contracts and 90 key items. Full report and audit
trail in `docs/eval-baseline-2026-09-10.txt`. Four things came out of it that need
changing, and one that needs watching.

- [ ] **1. The model files a finding for every clause it examines, not every problem
      it finds. Highest priority of the four.** Half the output is noise: 88 spurious
      findings against 90 real ones. On `eval-03-bayfront`, which has two real
      problems, it filed 25 findings — the extra 23 reading
      `finding_text: "...fully matches CD's standard. Compliant."` and
      `proposed_language: "No change recommended; clause aligns with CD standard."`

      Its judgement is right; the conclusion is written to the wrong field, and
      `clauses_checked` already exists for exactly this. **This is not a judgement
      problem and should not be treated as one.**

      Why it matters beyond the number: `lib/get-actioned-findings.ts`,
      `lib/export-memo.ts`, `lib/email-drafting/*` and the §1.5 redline engine all
      read `findings` as things to act on, so a "no change recommended" entry becomes
      a proposed change to a clause that was already fine — and the property email
      path would transmit it. An associate seeing 25 flags on a clean contract also
      stops trusting the tool, which is the failure mode no accuracy number captures.

      **Fixed 2026-09-10**, in `buildSystemPrompt` and `FINDINGS_TOOL_SCHEMA` in
      `lib/anthropic.ts`: a finding means a deviation, a compliant clause belongs in
      `clauses_checked` and nowhere else, and silence about a clause is the positive
      claim that it complies.

      Measured on four of the seven contracts, chosen as the extremes plus the two
      untested risks — $0.44 in total:

      | contract | key items | recall before | after | findings filed |
      |---|---|---|---|---|
      | eval-01 most adverse | 25 | 24/25 | **25/25** | 25 → 29 |
      | eval-03 nearly clean | 2 | 2/2 | **2/2** | 25 → 7 |
      | eval-05 twelve clauses absent | 14 | 14/14 | **14/14** | 25 → 16 |
      | eval-07 every margin narrow | 9 | 9/9 | **7/9** | 25 → 14 |
      | | **50** | **49/50** | **48/50** | **100 → 66** |

      A third fewer findings for one fewer catch, and eval-01 went from one false
      positive to none. Severity improved as a side effect: 96% exact on eval-01
      against 49% corpus-wide before, with one over-call and no under-calls.

- [x] **2. Severity over-calling — fixed 2026-09-10 by the same prompt change.**
      Anchoring severity to the library's `severity_default` and requiring a stated
      reason to depart from it took eval-01 from 49% exact corpus-wide to 96% exact,
      one over-call, no under-calls. Original note below.

- [ ] ~~**2. Severity is over-called.**~~ Half the calls are exact and 95% land within one
      band, but the model over-calls almost twice as often as it under-calls (29
      against 15), and 23 of the key's `medium` items came back `high`. If everything
      reads urgent, nothing does. Same prompt, same Opus rule: the library supplies
      `severity_default` and the model should depart from it only on the specific
      facts, saying why.

- [x] **3. The three "misses" were harness bugs, not misses. Fixed 2026-09-10.**
      Reading them individually showed the model had filed a correct finding for
      each — the 24-hour storm window, the 24-month menu lock at a 100% shortfall
      rate, the unilateral right to add fees after signature. The scorer refused
      each pairing because the finding quoted a sentence of the clause outside the
      span its anchors covered; one ended at character 15758 where its clause's
      anchors began at 15759.

      A clause's region is now the section it occupies rather than the hull of its
      anchors. Re-scoring the same captured run — free, no API — moved recall from
      96.7% to **100%**, and precision from 48.9% to 50.6%.

      Worth noting how it surfaced: the number looked plausible either way. It was
      reading the audit trail against the contracts that found it, which is the
      reason the trail is part of the report rather than a debugging aid.

- [x] **4. DONE 2026-09-22 (branch `fix/drop-no-change-findings`).** `dropNonChanges`
      in `lib/analysis-review.ts` runs inside `analyzeContract`, so the app and the
      eval both get it. It drops any finding whose proposed language declines to
      change anything, and the audit log keeps each one with a reason. Replayed on
      every saved run for free: it dropped 2–3 findings per current run, all true
      non-changes, with recall unchanged and precision up about a point. On the
      Sept 10 run it would have caught all 53 "no change recommended" entries.
      Original item below.

- [ ] ~~**4. Downstream consumers assume every finding is actionable.**~~ Even once the
      prompt is fixed, nothing between the model and the redline/memo/email checks
      that a finding proposes an actual change. A defensive filter is cheap insurance
      against a regression reaching a hotel. Decide whether to add one, or to rely on
      the eval catching it.

- [ ] **5. Narrow-margin deviations are dropped about two times in nine. New,
      2026-09-10.** On eval-07, whose every deviation is narrow, recall is 7/9 — and
      the two dropped differ between runs, so this is variance at the decision
      boundary rather than a fixed blind spot. A second, stronger prompt pass did not
      move it, and one run each cannot separate the two versions.

      These are the findings that matter most to keep: a comp-room ratio five rooms
      the wrong side of CD's, or a storm window twelve hours short, is exactly what an
      associate skims past. Worth another look when there is a reason to spend on
      several runs at once — a single run cannot tell a real improvement from noise
      at this sample size.

- [ ] **6. Three known defects in the eval corpus.** The contracts contain small
      inconsistencies the key does not know about, so every finding about one scores
      as a false positive and precision reads lower than it is. The F&B shortfall
      directive is ambiguous about whether the rate is of the shortfall or on top of
      it; the auxiliary-aids meaning was over-simplified and no longer states CD's
      position; and the assignment clause in eval-03 carries restrictions its spec
      never asked for. All three need the affected clauses redrafted, so they are
      worth fixing the next time the corpus is rebuilt for another reason, not on
      their own.

      **Two more, found by §2.0.2's perfect-run check (2026-09-11).** Neither needs a
      redraft, and both are fixable in a free rebuild from saved drafts.
      - `phrase()` in `lib/quantities.ts` rounds percentages to one decimal place.
        So eval-07's spec says a 1.25% finance charge while the contract prints 1.3%,
        and the findings key still carries 1.25%. Harmless to findings scoring, since
        both sit on the wrong side of CD's 1%. The terms key reads back the printed
        figure.
      - `roomBlockRows` in `lib/eval/corpus/layout.ts` prints per-night rooms that
        contradict the prose block. eval-01 says 340 on the peak night, and the table
        shows 170 every night. The terms key leaves `deal.peak_night_rooms` unkeyed in
        table-heavy contracts until this is fixed.

      **Five places where a draft plays a dictated figure in a different role, found by
      §2.0.2's first full run.** The drafting gates checked that each figure and meaning
      reached the prose, not what the figure ended up doing. The F&B shortfall defect
      above is two of them (eval-10, eval-15). The other three:
      - eval-03's named-storm 72 hours became the forecast window.
      - eval-12's deposit refund window became an accounting deadline, in a contract with
        no deposit.
      - eval-15's defined prepayment became "a percentage designated by the Hotel".

      The terms key follows the documents (`corrected` in `data/eval/terms-key-v1.json`).
      The findings key still carries the spec's values. Where the spec calls a clause
      compliant and the document doesn't (eval-03 named storm, eval-15 shortfall and
      prepayment), a correct finding scores as a false positive. That's more of the
      depressed precision item 6 describes.

- [x] **7. DONE 2026-09-22: `eval-capture` now uses `contractText`.** The findings eval reads slightly different text than production. New,
      2026-09-11.** `scripts/eval-capture.ts` joins a DOCX's parts plainly.
      `processAnalysis` flattens them with `contractText` (now
      `lib/docx/contract-text.ts`), which labels header and footer text as part of the
      agreement. So a term carried only in a footer reaches the eval model unlabelled.
      That's a one-line fix, but it changes what the baseline measured, so it should
      land with the next paid run rather than alone. The terms capture already uses
      `contractText`.

- **Watching: the harness itself is thin.** Seven contracts and 90 key items support
  the per-clause and per-severity breakdowns, but not reading any single percentage as
  a forecast. Eight more specs are written and held in `RESERVE_SPECS` — widening the
  corpus is moving an id into the active list and re-running the build. Exposure is
  graded on 15 of 87 pairs and proposed language on 57, both by design (see
  `docs/eval-harness.md` § Known limits). None of this blocks acting on items 1-4.

### Raised by the first end-to-end walkthrough (2026-09-11)

One contract carried from login to a sent-ready email in one sitting, as an associate
would — `eval-01-harborview.docx` uploaded through the real form, 25 findings reviewed,
10 accepted or edited, 2 dismissed, all four exports taken, both emails drafted. The
first three defects below all came out of the first ten minutes, and the user's own
connection dropping mid-run supplied the fourth for free.

**Fixed in this pass** (fade5a9):

- [x] **A filename with an em dash killed the upload.** Storage keys were built from
      `file.name` verbatim, and Supabase Storage rejects the punctuation Word and macOS
      put in real contract filenames ("Harborview Grand — NACE Annual Meeting.docx").
      The associate saw a raw `Invalid key:` string. `lib/storage-key.ts` now sanitises
      the key; the row still shows the filename as typed.
- [x] **A failed upload left an orphan negotiation.** The thread row is written before
      the file work that can fail, so every failed attempt added an empty negotiation to
      the "Continuing one" dropdown, un-usable and un-removable. Two were already
      sitting in the dev database from earlier testing. Every bail-out after that point
      now removes it.
- [x] **A dropped connection stranded an analysis at "processing" for ever.** The write
      that records a failure needs the network the failure took out, so the row kept no
      error and the review screen polled an analysis that would never arrive. Runs older
      than six minutes now read as stalled (`lib/analysis-status.ts`), and both the
      stalled and failed screens offer a real retry over the stored file
      (`POST /api/analyses/[id]/retry`) instead of a link to a blank upload form. The
      screen also keeps polling through a blip rather than stranding itself on the first
      failed fetch, and times the wait from the run's own start so a reload no longer
      resets the clock. Verified live: the stuck run recovered by clicking the button.

**Open, in the order agreed with the user (2026-09-11).** Items 1, 2 and 3 are done;
items 4-12 follow in this order, and none of them should be folded into a finished pass
— a restyle or a visibility change that also changes behaviour cannot be reviewed by
eye. Item 4 is next; items 4-12 are Sonnet 5 work under the CLAUDE.md table. Item 13
was added later and outranks 5-12; see its own note on sequencing.

- [x] **1. Visual style, raised by the user twice during the walkthrough. High
      priority. Fixed 2026-09-12 (4d67e3a), on `phase/ui-style-pass`.** A finding card
      carried five type sizes, an italic block quote, three button weights and four
      text colours, and the same inconsistency ran through the export dialog, the email
      panels and the forms — the user's words were that it "looks cheap". Fixed with a
      real typographic pass: five steps (`components/ui/typography.tsx`) applied
      everywhere in scope, no card over three of them; one dialog shell
      (`components/ui/dialog-shell.tsx`) replacing three different hand-rolled modal
      headers; uppercase confined to `StatusPill`; no italics on quoted contract text
      (a left rule and muted colour instead); Dismiss changed from secondary to ghost so
      each card carries one filled button; em dashes removed from hardcoded UI copy.
      Also fixed in passing: the export dialog's "Downloaded." confirmations were
      rendering grey instead of green because a broken color fallback
      (`--severity-low,#166534`) never fired — switched to the existing
      `--status-success` token. Verified live against the dev database's 25-finding
      Harborview analysis; `npm run lint`/`typecheck`/`test` all green (698/698).
- [x] **2. Selecting several exports at once silently loses files. Fixed 2026-09-12
      (ac6a8fd, 17901c5), on `phase/export-zip-fix`.** Four downloads fired from one
      click; the browser saved one and the picker reported "Downloaded." for all four,
      because `runMemo` and friends asserted success straight after `startDownload`
      without waiting for anything. Each route's orchestration moved to a builder in
      `lib/exports/`, one per format, returning bytes plus a `commit` closure holding
      the `exports` row and the audit entry. Splitting the side effects out lets
      `?preflight=1` report a verdict without logging, and lets the new
      `/api/analyses/[id]/export-zip` route write one row per file it actually
      delivers, so §1.6.6's degradation rate reads the same whether an associate took
      one file or four. `downloadFile` replaced `startDownload` and fetches, so a row
      reports "Downloaded." only once its response has resolved.

      A format whose verdict is not clean stays out of the zip and expands its existing
      verdict row instead (decided with the user) — a partial redline is missing
      findings, and §1.6's point is that the associate reads which ones before sending
      it. They download that one file afterwards. The zip route still skips a refusal
      rather than failing the whole archive, and names it in a `NOT-EXPORTED.txt`
      inside.

      Also fixed in passing: an em dash in `Content-Disposition` threw before any bytes
      reached the associate, and the tracked-changes export names its file after the
      uploaded contract — so "Harborview Grand — NACE Annual Meeting.docx" would have
      500'd on a single-file redline export. The header now carries RFC 5987's
      `filename*` beside a stripped ASCII fallback.

      Follow-up in the same pass (280ae1f, `phase/export-build-cache`): the preflight
      threw its build away and the download rebuilt it, so the redline engine and the
      clean-contract build each ran twice for one click. Both now go through a
      short-lived process-local cache (`lib/exports/build-cache.ts`), keyed by a
      fingerprint of the inputs, so a decision changed between the two requests forces
      a rebuild rather than serving a stale document. The redline preflight went from
      8.8s to 1.2s warm. An export the associate cannot take is also now left out of
      the dialog rather than shown greyed with an excuse.

      Verified live against the dev database: all four selected produced one
      `exports-99fe1054.zip` holding all four files (the redline with 10 `w:ins` and 10
      `w:del`, matching its 10 accepted findings) and exactly four `exports` rows;
      each format standalone produced the same file as before; on a PDF-sourced
      analysis a refused format left its error on the row while the other two still
      zipped; and dismissing one accepted finding dropped the next redline to 9
      tracked changes, confirming the cache rebuilds on a changed decision.
      `npm run lint`/`typecheck`/`test` all green (714/714).
- [x] **3. The proposed language is hidden behind a disclosure while Accept sits in the
      open. Fixed 2026-09-12 (c2de4a9), on `phase/proposed-language-default`.** The
      replacement wording is the thing that reaches the hotel, and an associate could
      accept 25 findings without ever reading one. `proposed_language` now renders
      directly on the finding card (no click needed); `cd_standard` moved into its own
      single-item disclosure instead. No behaviour change — submitAction, the edit
      flow's pre-fill, and the API calls are untouched. Verified live against the dev
      database's Harborview analysis; `npm run lint`/`typecheck`/`test` all green
      (698/698).
- [x] **4. The thread view says exports were "sent". Fixed 2026-09-12 (491cf34), on
      `phase/roadmap-4-exports-downloaded`.** Nothing in this app sends anything, and
      the round timeline's one line saying otherwise now says "downloaded". It also
      printed the raw duplicated format list ("sent pdf, docx, pdf, memo, memo") — the
      `format` enum can't tell a marked-up PDF from a proposed contract apart, so both
      are just "pdf". Replaced with a file count and the most recent download date
      (`app/(app)/threads/[id]/page.tsx`). Verified live against the Harborview thread
      in the dev database: reads "28 files downloaded 9/12/2026". 714/714 tests, lint
      and typecheck clean.
- [x] **5. The edit box is four rows for a 600-character clause. Fixed 2026-09-12
      (branch `phase/roadmap-5-textarea-height`).** `rows={4}` on the finding card's
      edit textarea gave a 98px window for editing contract language.
      `FieldTextarea` is shared with the standards admin screen and both email
      panels, so the fix is at the finding-card call site only
      (`app/(app)/analyses/[id]/finding-card.tsx`) — `rows={10}`. The component
      already carries Tailwind's default `resize: vertical` with no override
      disabling it, so the drag handle to expand further was already there; the
      missing piece was real starting height. Verified live against the Harborview
      analysis: an editable 600-character clause now shows in full with no
      scrolling, `getComputedStyle(textarea).resize === "vertical"`. 714/714 tests,
      lint and typecheck clean.
- [x] **6. Nothing warns at export time that 13 findings are still undecided. Fixed
      2026-09-12 (branch `phase/roadmap-6-undecided-warning`).** The header said so,
      but the export dialog, where it matters, didn't. `undecidedCount` was already
      computed in `app/(app)/analyses/[id]/page.tsx` and now passes into
      `ExportPicker`, which renders one warning above the format list — not per row —
      when it's greater than zero. `components/export-picker.tsx`'s two-phase
      export flow (preflight settle, then zip) is untouched. Verified live against
      the Harborview analysis (13 undecided of 25): the dialog reads "13 findings
      still need a decision and won't be in any of these exports." above the
      checkboxes. 714/714 tests, lint and typecheck clean.
- [x] **7. No overview of a review. Fixed 2026-09-12 (branch
      `phase/roadmap-7-review-overview`).** A sticky bar now sits above the findings
      list: severity-count chips that double as filter toggles, the undecided count,
      a "hide decided" toggle, and a total-exposure figure — all whole-review totals,
      not filtered readouts, so they stay honest even while some findings are hidden.
      Arrow-key navigation moves a focus ring (`ring-2 ring-[var(--cd-blue)]`,
      distinct from the severity left-border) through the currently visible findings
      and scrolls each into view, reusing the existing `handleSelectFinding` so the
      document-preview highlight stays in sync — no key takes an action, so a stray
      keypress can't accept or dismiss anything, and the effect is ignored while a
      finding's own edit/dismiss textarea or select has focus. Deciding the
      currently-focused finding auto-advances to the next visible undecided one
      (never wrapping) — this is what actually fixes "loses their place after ten
      decisions."
      `lib/findings-overview.ts` (new) holds `computeFindingsOverview` and the
      severity ranking `SEVERITY_ORDER`, hoisted out of an inline object that used to
      live only in `page.tsx`; `lib/format.ts` gained `formatCurrency`, also now used
      by the per-finding exposure line in `finding-card.tsx` in place of an ad hoc
      `.toLocaleString()`. New `findings-overview-bar.tsx` component;
      `finding-card.tsx` gained a `focused` prop and a `finding-<uuid>` DOM id for the
      scroll target. `page.tsx`'s `sortedFindings` is now memoized (previously
      recomputed unmemoized on every 2s poll tick), and the header's old "N still
      need a decision" line moved into the overview bar rather than appearing twice.
      Scoped to structure and behavior only, reusing existing design tokens
      (`SEVERITY_STYLE`, `StatusPill`, `Card`, typography) — item 13's visual
      redesign of this same screen is separate and can reskin the new focus ring
      without restructuring markup.
      5 new tests in `tests/findings-overview.test.ts`. **Verified live** against the
      Harborview fixture (25 findings, mixed severities): severity chips summed to
      25 and matched a manual sum of `exposure_amount` ($621,120, checked against the
      raw API response); toggling a severity chip changed the rendered card count by
      exactly that severity's count; "Hide decided" dropped the list to the 13
      undecided cards while the bar's counts stayed fixed; arrow keys moved the
      focus ring through visible cards only and did nothing while a `FieldTextarea`
      had focus; accepting the focused finding auto-advanced to the next undecided
      one and the card count/undecided count both dropped by one. 719/719 tests
      (5 new), lint and typecheck clean.
      Verifying auto-advance required actually accepting one real finding in this
      fixture (dev database), moving it from 10 to 11 accepted findings — left as-is
      per the user's call (dev data, not a real deal), so **the fixture's baseline is
      now 11 accepted / 12 undecided / 2 dismissed**, not 10/13/2 as noted elsewhere
      in this file and in CLAUDE.md.
- [x] **8. A wrong file type is only caught server-side. Fixed 2026-09-12 (branch
      `phase/roadmap-8-client-side-filetype`).** `hasAcceptedExtension` checks the
      filename against `.pdf`/`.docx`/`.doc` client-side, wired into both the file
      input's `onChange` and the drop handler, with the same message the server
      already used ("Unsupported file type. Upload a PDF, DOCX, or DOC contract.").
      Checking the extension rather than `file.type` is what makes drag-and-drop
      work — a dropped file's MIME type can come back empty depending on OS/browser,
      but the `accept` filter never even runs for a drop in the first place.
      `app/(app)/upload/page.tsx`. The server-side check in
      `app/api/analyses/route.ts` is untouched — it's still the one that counts.
      Verified live: dropping a fake `.exe` shows the error immediately with no
      network request, and dropping a `.pdf` after clears it and registers the
      file. 714/714 tests, lint and typecheck clean.
- [x] **9. The property-name field on the upload form has no label of its own. Fixed
      2026-09-12 (branch `phase/roadmap-9-property-name-label`).** It carried only the
      group label "Negotiation" and a placeholder. The single `Field` wrapping the
      whole negotiation section (toggle buttons plus the conditional input) is split
      into a plain group label for the two buttons and a real `Field` around each
      conditional branch — "Property name" for a new negotiation, "Which negotiation"
      for the thread picker, both using the shared `Field` wrapper in
      `components/ui/field.tsx`. `app/(app)/upload/page.tsx`. Verified live in both
      modes. 714/714 tests, lint and typecheck clean.
- [x] **10. "Client" is described as an "internal email for the firm." Fixed 2026-09-12
      (branch `phase/roadmap-10-client-email-noun`).** It goes to CD's customer, the
      group or association negotiating the contract, not to the firm itself. The
      warning about exposure figures and negotiating rationale, and never sending it
      to the property, is unchanged and correct — only the noun describing the
      recipient was wrong (`components/email-picker.tsx`). Verified live in the
      "Who is this email for?" picker. 714/714 tests, lint and typecheck clean.
- [x] **11. The memo downloaded as `e.pdf` once. Verified, not reopened, 2026-09-12
      (branch `phase/roadmap-11-memo-filename-verify`, no code change).** Not
      reproduced. The live `Content-Disposition` header off the memo route reads
      `attachment; filename="requested-revisions-99fe1054.pdf";
      filename*=UTF-8''requested-revisions-99fe1054.pdf`, and `lib/download.ts`
      doesn't rely on the browser to parse it — `save()` reads the header itself
      with its own regex and sets `a.download` explicitly before the blob-URL click,
      which resolved correctly to `requested-revisions-99fe1054.pdf` in a real
      download. The one `e.pdf` sighting looks like an artifact of the earlier
      browser-automation environment, not this code path.
- [ ] **12. Mobile — low priority, by the user's call (2026-09-11).** Associates are not
      expected to run this on a phone. Recorded so it isn't rediscovered: the dashboard
      table runs off-screen and hides the Status column, and the review header collapses
      into a cramped ribbon.
- [ ] **13. A second style pass, beyond item 1's typography. Raised by the user
      2026-09-12, fairly high priority — above items 5-12.** Item 1 fixed consistency,
      not design. It applied a five-step type scale, collapsed three hand-rolled modal
      headers into one dialog shell, confined uppercase to `StatusPill`, dropped
      italics on quoted contract text and settled button weights. What it deliberately
      did not touch is the look itself — colour, spacing, density, the shape of a
      finding card, how a screen reads at a glance.

      **In progress. The review screen is scoped and two pieces have shipped;
      the dashboard and upload form are still open.**

      - [x] **Header hierarchy, finding-card grouping, styled checkboxes —
            shipped 2026-09-12/13** (branch `ui/pre-demo-polish`, merged
            1c6deaf). First pass at the review screen specifically: the
            analysis header's visual hierarchy, how findings group on the
            card, and replacing default checkbox styling with a real
            component (`components/ui/checkbox.tsx`).
      - [x] **Finding card cut down to a "quiet ledger" — shipped 2026-09-13**
            (branch `ui/quiet-ledger-finding-card`, merged 5b42ec5). The card
            still carried four type sizes and roughly eight distinct colours
            for its own metadata and structure even after item 1's pass —
            severity was a coloured pill, status was a second coloured pill,
            and two near-identical greys (`--text-secondary`/`--text-muted`)
            did the same job. Picked from three rendered alternatives (a
            comparison artifact, not committed to the repo). Severity is now a
            small dot instead of a pill; the quote and proposed-language
            sections read at the same size as everything else, with a hairline
            rule and a small-caps label carrying the structure instead of a
            size jump or a tinted box. Down to two type sizes and four colours
            on the card. `app/(app)/analyses/[id]/finding-card.tsx`.

      - [x] **Dashboard and upload form — shipped 2026-09-22** (branch
            `ui/dashboard-upload-restyle`). The user called the upload screen
            chaotic, with many different sizes. It had four control heights
            (34–38px), a file picker indented 14px from everything else, and a
            half-width negotiation switch with 12px text. Every control is now
            full width at one left edge, 40px tall and 14px text, with 6px from
            label to control and 20px between fields. The file picker is a drop
            zone that shows the chosen file, and the switch is a shared
            `SegmentedControl`. On the dashboard, the four stat cards became one
            strip with hairline dividers, and the status column is left-aligned so
            every pill starts on the same line. The user kept the pills over a dot.
            "High-severity findings" became "Reviews needing decisions", which
            counts complete reviews with at least one undecided finding.
      - [x] **Standards library screen — shipped 2026-09-23** (branch
            `ui/standards-library-restyle`). The user found it long and clunky
            at 34 entries, with too many font sizes. The 34 stacked cards
            became collapsible two-line rows, grouped under HIGH, MEDIUM and
            LOW headings, and the page roughly halved in length. The review
            screen's severity toggles filter it, now shared as
            `components/severity-toggles.tsx`, and a search box matches clause
            names and positions. The page uses three text sizes (20, 14 and
            12px), and editing is unchanged.
      - [x] **Finding card, "change first" — shipped 2026-09-23** (branch
            `ui/finding-card-sections`). The user found the card read as one
            paragraph in several sizes, and picked option B of three rendered
            layouts. The card now has:
            - a header line
            - a one-line headline
            - an exposure box
            - the contract's current wording above the proposed wording, in one box
            - the reasoning beneath

            It uses 16, 14 and 12px. The model writes the headline (new
            required schema field, prompt rule, `findings.headline` from
            migration 007, applied 2026-09-23). Older findings fall back to
            `finding_text`, and the property email allowlist test asserts the
            headline never reaches a hotel. **The headline prompt is
            unmeasured.** One eval run (about $1.20) waits on the user's
            approval.

      Same rule as the rest of this list: a restyle must not carry a behaviour change,
      or it cannot be reviewed by eye.

**A redline was opened in real Word for the first time (2026-09-11).** The user opened
this walkthrough's export in Word for Mac. Every previous claim about the redline rested
on the reject-round-trip oracle, never on a human seeing it, and
`docs/redline-export-plan.md` had said this check could not be done from here. Word
rendered the insertions inline and the deletions in margin balloons, with the revisions
attributed correctly.

- **Addressed 2026-09-23 (see "Redline readability" below): new wording now comes
  before struck wording.** A balloon for a replacement reads
  `Deleted: <old sentence>.<first words of the new sentence>` with no separator, because
  Word treats an adjacent `w:del`/`w:ins` pair as one revision and runs the two together
  in the balloon. The XML is one deletion and one insertion as siblings, correctly
  marked, and the inline text keeps its spacing. Reading the same file with
  Review → Markup Options → Show All Revisions Inline avoids it entirely, which is also
  how most counterparties read a redline. Worth putting in associate guidance, and worth
  testing whether emitting the insertion before the deletion reads better in balloons.
- **Compatibility Mode comes from the corpus, not the engine.** Neither the eval contract
  nor the redline carries a `word/settings.xml`, and Word flags any such file. Contracts
  authored in Word have one, so this will not appear on a real upload. Cheap to fix in
  the corpus generator if it ever confuses a demo.
- **Still unverified**: accepting and rejecting individual changes by hand in Word, and
  how the strike-and-clone table replacement renders there.

**Confirmed working, for the record.** The DOCX preview rendered the room-block and
cancellation tables as real tables; "Show in document" highlighted the right clause;
exposure arithmetic was shown with its basis ($392,840 = 340 rooms × 4 nights × $289);
the edit flow pre-filled the model's proposal and carried the edited figure through to
the property email; the property email leaked no exposure figure, severity or rationale;
and the tracked-changes redline passed all ten validation checks with 10 of 10 accepted
changes applied, clean, including the reject-round-trip.

**Redline readability (2026-09-23, branch `redline/cleaner-changes`, merged).** The
user compared three layouts of the Monarch eval redline in Word, and chose to mark only
the words that change, with new wording before struck wording.

- **What the engine now does:**
  - It marks only the words that change. Shared words stay as plain text
    (`lib/redline-engine/word-diff.ts`).
  - A proposal that keeps less than half of the quote's words is a rewrite, and gets one
    change over the whole passage. So does a passage holding anything but plain text.
  - Each insertion comes before its deletion. The user confirmed in Word that margin
    notes no longer run old and new wording together.
  - A change stretches over wording the proposal repeats just outside the quote, so
    accepting it doesn't print that wording twice (`fit.ts`).
  - Every change covers whole words. A loose match had begun at "ditioned" in
    "conditioned" (Monarch §21, a misquote).
  - A proposal written as whole sentences, for a quote that starts or ends partway
    through the contract's sentence, replaces the whole sentence. The user chose this
    over leaving the change out. The export screen lists each one with the extra
    wording it strikes, under "check them in Word before sending", and never downloads
    such a file before showing that list.
  - A change is left out, with a reason on the export screen, when its wording has an
    unfilled blank such as "[X]" or reads as an instruction to the reviewer
    (`wording.ts`). Migration 008 (applied) lets `findings.applicability` record this
    as `blocked_wording`.
- **Eval run `checker-2026-09-22` (183 findings, matches the current corpus): 160 apply,
  no failed checks, and no change starts or ends partway through a word.** Measure
  against this run. `standards-2026-09-22` predates the last Bayfront edit, so five of its
  Bayfront quotes point at wording that no longer exists.
  - **19 of the 160 cover the whole sentence.** Most strike a qualifier that CD's wording
    replaces, such as commission's ", whether such rooms are booked…". A few strike
    wording that protects the group, which the associate must check. Examples are the
    named storm cancellation rights (Monarch, Crossroads), F&B menu-change consent
    (Crossroads) and the force majeure opening (Vantage). The prompt fix on
    `prompt/whole-sentence-quotes` should make these rare.
  - **The 23 left out:**

    | Reason | Count | Status |
    |---|---|---|
    | Unfilled blank | 19 | Provisional values now fill the standards' blanks (see "Provisional values for CD to confirm"). Saved runs and existing reviews keep "[X]" until re-run or edited. |
    | Quote not found | 2 | Monarch ADA shortened its quote with "…" (prompt fix on `prompt/whole-sentence-quotes`). Crossroads billing stitched two passages together, a one-off misquote. |
    | Crosses a paragraph break | 1 | Engine limit, below |
    | Instruction, not wording | 1 | Vantage cancellation: "Reconcile the narrative … schedule and the table …" |

    `npm run eval:score` now reports these counts for any run (see `docs/eval-harness.md`).
    It holds back the 3 findings that propose no change, as every export does, so it
    reads 157 applied for this run rather than 160.

- **Still open:**
  - **Prompt branches, measured 2026-09-23 (run `combined-2026-09-23`, about $2.08).**
    Branch `prompt/combined-run` holds both `prompt/clause-checklist` and
    `prompt/whole-sentence-quotes`. Full results are in that branch's
    `docs/eval-harness.md`.

    | | Two baselines | Combined |
    |---|---|---|
    | Recall | 88.7% / 88.1% | 98.2% |
    | High-severity recall | 80% / 87% | 100% |
    | Repeat misses caught | — | 7 of 8 |
    | Redline applied | 157 / 146 | 155 of 203 |
    | Whole-sentence changes | 19 / 12 | 1 |
    | Left out: not found or crossing a paragraph | 3 / 1 | 44 |
    | Output per run | 93k tokens | 159k tokens |
    | One attempt | 54–151s | 163–253s |

    - **Checklist:** it works. It costs about $0.26 a contract instead of $0.17, and
      about twice the time. The app now allows 7 minutes (merged, `analysis/long-reviews`).
    - **Quotes:** the whole-sentence rules made the model quote whole clauses, joining
      sentences that are apart and running across paragraphs. The rule now asks for only
      the sentences being changed, from one paragraph. That rewrite is unmeasured.
    - **Next check (paid, not approved):** `eval:capture --only
      eval-01-harborview.docx,eval-10-crossroads.docx` on `prompt/combined-run`, about
      $0.60. Merge the combined branch once quotes place again.
    - **Florida misses, prompt rules added 2026-09-24 (unmeasured).** Four Florida runs
      all missed three terms, so the combined branch now carries rules for them:
      - a no-finder promise, which conflicts with CD's commission
      - a termination right over unapproved logo use, as an Other finding
      - concessions that depend on the same 80% pickup as the attrition minimum, as a
        rebates finding

      A rule also says to read the closing boilerplate as closely as the named
      clauses. Other findings and document notes no longer have a count limit.
      `max_tokens` is 64,000, since the last Florida run used 28,859 of 32,000. A cut-off
      answer now fails without a second paid attempt, and `token_usage.thinking_chars`
      records how much output went to thinking. The next Florida run (about $0.40) is
      the check.
    - **Monarch's first attempt came back unreadable** after 23k output tokens and cost
      a retry. A list sent as text is now decoded instead of retried, and the error
      names what each field held.
  - **Ask CD:** should proposals edit the contract's own wording, or paste CD's
    standard wording as now? Pasting makes most changes whole-passage rewrites, such as
    the commission clause. Nothing changes until CD answers.
  - **Blanks elsewhere.** Blanks can still reach the property email and the clean
    contract, and the review screen doesn't prompt the associate to fill one before
    Accept. This is flagged as its own task.
  - **Known limit.** One change can't span two paragraphs (Granite Bay billing, 1 in 183).
    Striking across paragraphs is real §1.5 work. Revisit if it shows up in real
    contracts.

**Provisional values for CD to confirm (2026-09-23, branch
`standards/provisional-blank-values`).** CD's template leaves blanks in 13 clauses'
fallback wording. The model copied them into its proposals, and the redline correctly
refused to send "[X]". So the full flow can be tested, each blank is filled with a typical
industry figure, or with wording that points at the contract's own facts. **None of these
are CD's numbers.** Ask CD for each, then change it on the Standards Library admin screen,
which is audited. `lib/standards/v1.ts` and the live table hold the same values
(`standards:status` matches), and `tests/standards-blanks.test.ts` keeps new blanks out.

| Clause | Template blank | Provisional value | Typical range | CD answer |
|---|---|---|---|---|
| Attrition, Cancellation | rebook credit if rebooked "within [X] years" | three (3) years | 2–3 years | open |
| F&B minimum | menu prices "confirmed at [year] pricing" | "the Hotel's pricing in effect on the date of this Agreement" | a deal fact | open |
| F&B minimum | "a food and beverage minimum of $[X]" | "the food and beverage minimum stated in this Agreement" | a deal fact | open |
| Walk / relocation | credit "$[X] for each night a guest is relocated" | $200 | about $100–250 (estimate) | open |
| Construction / renovation | facilities "fully operational by [date]" | "no later than ninety (90) days before Group's arrival" | 60–120 days | open |
| Review / audit dates | reviews "by [date] (24 months prior)" and "by [date] (12 months prior)" | 24 and 12 months prior to arrival | the template's own note | open |
| Review / audit dates | block change "up to [X]% at each review and [X]% cumulatively" | 10% each, 20% cumulative | 10–20% / 20–30% | open |
| Review / audit dates | pickup reports "starting [X] days prior to the cutoff date" | 60 days | 30–90 days | open |
| Labor disputes | "One year in advance, or no later than [date]" | "…or within thirty (30) days of signing this Agreement if that is later" | wording | open |
| Gratuity / service charge | gratuity "[X]%" and retained service charge "[X]%" | 18% gratuity, 6% service charge (24% in total) | totals now 24–32%, with a staff gratuity historically 15–20% | open |
| Banquet service levels | labor fee "$[X]" for functions under 25 people | $150 | about $100–200 (estimate) | open |
| AV / internet | AV discount "[X]%", internet discount "[X]%" | 20% each | 15–20%, up to 25% | open |
| Nondiscrimination | "the state of [state] or the city of [city]" | "the state or city in which Hotel is located" | a deal fact | open |

Two bracketed notes were also turned into wording:
- **Commission.** "[Outside the USA: …]" is now the sentence "If Hotel is outside the
  United States, commission also applies to …". The meaning is unchanged.
- **Rate parity.** The alternative is removed from the fallback, so the model proposes
  only the primary wording. Ask CD which to use. The alternative reads: "Hotel will
  include all rooms booked by Group attendees in the room block regardless of rate paid,
  and will immediately cease selling rooms to transient or group guests at the lower
  rate."

New reviews use these values. Existing reviews and saved eval runs keep "[X]" until they
are re-run or edited. The eval answer key was re-stamped with the new standards
fingerprint at no cost. Its 168 key items are unchanged, because the corpus never reads
fallback wording.

**Provisional compromise ranges (2026-10-02, branch
`feature/business-legal-standards`).** Typical industry give, not CD's numbers. Blank
where there's no sensible numeric give. Commission is left for CD to set, because it's
CD's own fee. Change any of them on the Standards Library screen.

| Standard | Provisional compromise range | CD answer |
|---|---|---|
| Attrition | trigger up to 80% of the block, still cumulative; damages up to 80% of the rate | open |
| Cancellation | room profit up to 80% of the rate; keep the scale and the resale duty | open |
| F&B minimum | shortfall billed at 35–50%; menu pricing locked 6–12 months out | open |
| Cutoff date | 21–30 days before arrival | open |
| Comp rooms & rebates | one comp per 40–50 occupied room nights | open |
| Master account billing | finance charge capped at 1–1.5% a month, after at least a 30-day dispute window | open |
| Damage deposit | refunded within 30–45 days | open |
| Construction & renovation | notice within 30–60 days of plans being confirmed | open |
| Brand or ownership change | notice within 30–60 days; termination window of at least 30 days | open |
| Labor disputes | contract-expiry notice 6–12 months ahead; cancellation for disputes within 60–90 days | open |
| Future rate cap | increase capped at 2–4% a year; rates fixed 9–12 months out | open |
| Rate parity | rate no higher than other groups' within 3–7 days of the event | open |
| Facilities & services | closures or cuts over 25–35% trigger the alternatives duty | open |
| Resale mitigation duty | damages due 30–60 days after the meeting | open |
| Banquet service levels | ratios up to 20% looser than the standard | open |

### Pre-demo review (2026-09-26)

A whole-app review before the demo: every screen graded, the live site toured
at desktop, tablet and phone widths, and the code read for duplication and
structure. No paid calls. Fixed before the demo on `fix/pre-demo-polish`:

- [x] Re-editing a finding after a reload started from the original proposal,
      so saving overwrote the associate's earlier edit.
- [x] A dropped connection during Accept, Edit or Dismiss failed silently.
- [x] With nothing accepted yet, the client email said the contract needed no
      changes. It now asks for decisions first, like the property email.
- [x] Below 1024 px the findings were unreachable under the contract (iPad
      portrait, phones). Each pane now scrolls on its own.
- [x] Uploads over 10MB were cut off by the sign-in proxy despite the 32MB
      promise (`experimental.proxyClientMaxBodySize`). Too-large files are
      refused before upload.
- [x] Dialogs ignored Escape, took no focus and weren't announced as dialogs.
- [x] The marked-up PDF and the proposed contract were plain text with the
      tables and paragraph breaks lost, and the markup struck whole lines with
      the new wording on a cover page. For Word uploads both are now drawn from
      the tracked-changes file (`lib/structured-pdf.ts`): headings, lists,
      tables with Word's column widths, deletions in red and insertions in
      blue, in place. A clean Word copy was added (`lib/docx-accept.ts`).

**Later, by priority:**

- [ ] **Medium.** PDF uploads still get the older marked-up PDF: whole lines
      struck on the original PDF and the new wording on a cover page. Strike
      only the matched words and put each change's wording in a margin note
      beside it. Their proposed contract stays plain text, since a PDF has no
      structure to rebuild from.
- [ ] **Low.** The structured PDFs leave out headers, footers and pictures such
      as a hotel logo, and use Liberation Sans rather than the document's font.

- [x] **Medium.** The "Forgot password" form let anyone create a Supabase
      login for any email. It now passes `shouldCreateUser: false`, and an
      unknown email gets the same "link is on its way" reply as a known one.
- [ ] **Medium.** Opening Email → Client or Property generates a new draft on
      every open, a few cents each. Reuse the saved draft and offer "Draft again".
- [ ] **Medium.** A review stalled at "processing" (for example after a Render
      restart mid-run) counts against the monthly limit until someone retries it.
- [ ] **Low.** Four API routes return raw database error text in their 500
      responses. Show a plain message and log the detail.
- [x] **Low.** The memo could be picked in the export dialog with nothing
      accepted, which gave an empty PDF. With nothing accepted, the dialog now
      lists no files and says to accept a finding first, since the redlined
      contract would be an unmarked copy too.
- [ ] **Low.** The in-progress screen is four minutes of a pulsing bar. Show steps
      (scanning, reading, checking, saving).
- [ ] **Low.** Wording: "Round 1 of Florida Demo Resort" reads oddly; a bad
      review link says "Try uploading again" rather than "Back to dashboard".
- [ ] **Low.** Phone: the dashboard's recent-reviews table drops the Status
      column, and the navigation menu doesn't close on Escape.

**Code health, later:**

- [ ] `lib/anthropic.ts` (1,269 lines) holds six model calls: review, client
      email, property email, term extraction and two eval-only calls. Split by
      concern with one shared tool-call helper; the prompt goldens make it
      safe. 2–3 hours.
- [ ] One shared module for the storage bucket name (defined in 10 files),
      month names (4) and money patterns (3). About an hour.
- [ ] Nine API routes copy the same load-and-check-owner code. One helper, like
      the export gate (`openExport`). 1–2 hours.
- [ ] `components/export-picker.tsx` (730 lines) repeats its five format rows
      and two result panels. Build them from one list. About an hour.
- [ ] The review page repeats the AI-check condition instead of
      `isAwaitingAiUseDecision`. Five minutes.
- [ ] `lib/tracked-changes-docx.ts`, the old redline engine, is now used only by
      tests. The user decides whether to delete it and its tests (CLAUDE.md
      deviation 4 kept it until the §1.5 engine passed all 12 fixtures).

### Deploy and client-presentation readiness (2026-09-22, high priority)

A client presentation is expected this week. Item 13's redesign (above) is done;
this is what's left before someone outside CD sees the tool. See CLAUDE.md's
Agreed deviations item 7 for the data-handling decision behind item 7 below.

- [x] **1. Deploy to Render.** Done 2026-09-26: https://cd-contract-reviewer-pro.onrender.com,
      auto-deploys `main`. Web service connected to GitHub, `npm run build` /
      `npm start` (unchanged commands, no code change needed). Set the five env
      vars from `.env.local` in Render's dashboard. Verify `postinstall`
      (`scripts/copy-pdf-worker.mjs`) runs in Render's build. Supersedes the
      Vercel-Pro note elsewhere in this file — see the 2026-09-19 hosting audit.
      Node is pinned to 24 in `.node-version`, which Render and CI both read.
      Checked locally on 2026-09-25 on `prompt/combined-run` (39898ce):
      `npm run build` passes with no warnings, and `npm start` served sign-in,
      the dashboard, upload, account, standards, a DOCX and a PDF review, and
      all four exports with no server errors.
- [x] **2. Starter tier ($7/mo), not Free.** Done 2026-09-26. Free spins down after 15 minutes
      idle with a 30-60s cold-start wake on the next request — a real risk if
      the app is opened cold in front of the client.
- [x] **3. One full smoke test on the deployed instance**: login, upload, a real
      analysis end to end, review, export, draft an email. Done 2026-09-26 with
      the live Florida run (`15e91734`) and every export. Email drafting wasn't
      exercised live, because it costs a model call.
- [x] **4. Clean up the demo account.** Done 2026-09-26: a fresh admin account,
      jerry.horan@conferencedirect.com, holding only Florida. The dashboard currently shows a dozen
      internal test rows ("AI Clause Gate Test," etc.) — fine for development,
      not for a client watching. Fresh associate account or a delete pass.
- [ ] **5. Dry-run the actual redacted contract once, before the live
      presentation, not during it.** A real contract can hit table layouts or
      formatting the synthetic eval fixtures never exercised.
- [ ] **6. Confirm the existing safeguards are unaffected**: the property-email
      field allowlist, the "not legal advice" disclaimer, and audit logging all
      apply regardless of which Anthropic account processes the call — no new
      engineering expected here, just worth checking once live.
      Checked locally on 2026-09-23:
      - The allowlist tests pass and cover the new `headline` field.
      - The disclaimer shows on the upload form and the review screen, and on
        every page of a 10-page memo.
      - Every audit action the code writes has rows in `audit_log`.
      - The signature route was the one write without an audit entry. It now
        logs `signature_updated`.
      Checked on Render on 2026-09-26:
      - The disclaimer shows on the upload page, the review screen and every
        page of Florida's memo.
      - Render wrote Florida's `analysis_upload`, `analysis_complete` and
        export audit rows.
      - The property-email allowlist was checked live on 2026-09-27. A draft
        on Florida carried no figures, exposure, severity or rationale.
- [ ] **7. A redacted real CD contract will be processed on the personal
      Anthropic account for this presentation, ahead of the build brief's own
      gate** (decided by the user, 2026-09-22). CD's Anthropic org still does
      not exist. See CLAUDE.md's Agreed deviations item 7 for the full
      reasoning and the explicit scope limit — this does not extend past this
      one presentation.
- [x] **8. DONE 2026-09-22 (branch `standards/2026-revision`, 1c267f9 and
      58078b7).** Revised against "CD Contract Template" (modified
      2026-02-25). 17 entries changed, 9 clause types added (34 total), and
      the live table was updated through the audited admin PATCH route plus
      the seed script. `standards:status` confirms the live table matches
      `v1.ts`. The eval corpus was rebuilt for about $0.41–0.82, redrafting 19
      clauses in 4 contracts. Open follow-ups:
      - DONE: the mismatch guard compares `standards_hash`, and the eval ran
        fresh (runs `standards-2026-09-22` and `checker-2026-09-22`, results
        in `docs/eval-harness.md`). 11 checks cover the new positions.
      - Still open: checks cover part of each position, the ADA check
        contradicts CD's position (redrafting six contracts costs about
        $0.90), and the findings key has no correction mechanism for
        drafted text that says more than its spec.
      - The model flags silence on the newer terms inconsistently. Recall
        is 88.7% against the new key. A repeat run (`baseline-repeat-2026-09-22`)
        scored 88.1%, but only 8 of its 20 misses were also missed the first
        time, so most misses are chance rather than fixed blind spots.
      - Branch `prompt/clause-checklist` asks for a verdict on every clause
        type before findings, and records disagreements between verdicts and
        findings as `review_gaps`. It needs one paid run (about $1.30) to
        measure. A drop of two or three misses is within run-to-run noise.
        Score it with `--baseline checker-2026-09-22 --baseline
        baseline-repeat-2026-09-22`. The test is how many of the 8 items
        both baselines missed it catches.
      - The template's attrition formula says 75% while its headline says
        70%. The library keeps 70%, and the question should go back to CD.
      - Commission findings appear in client memos and emails like any
        other finding.
      Original item: update the standards library from a newly
      received revised ideal contract (raised 2026-09-22, Opus 5). CD sent an
      updated ideal/standard contract since `lib/standards/v1.ts` was last
      written. A new session needs to read it and update `position`,
      `severity_default`, and (where stated) `walk_away_condition` wherever the
      new document's language differs from what's encoded today, going through
      the existing standards admin screen / provenance-and-validation-stamp
      workflow (§1.7) rather than hand-editing the file directly, so migration
      `003`'s fingerprinting stays meaningful. Getting a position wrong here is
      silent and propagates into every review after it, which is why this is
      an Opus task, not Sonnet.
- [ ] **9. Before hand-off to CD, set up "Sign in with Microsoft" with CD's
      IT** (the user asked to be reminded, 2026-09-24). Email + password is
      the sign-in for now. CD's IT needs to:
      - register an app in Entra ID
      - give us its client ID, secret and tenant ID for Supabase's Azure provider
      - add Supabase's auth callback URL to the app's redirect URIs

      The `associates` allowlist check still runs after a Microsoft sign-in.

      CD is weighing Microsoft sign-in against MFA (2026-10-06). "Beta
      preparation" item 7 compares the two and holds the hand-off guide.
- [x] **10. Monthly review limit (2026-09-24).** Each associate gets
      `MONTHLY_REVIEW_LIMIT` reviews per UTC calendar month. It is 30 for now,
      a provisional number the firm will set. Every upload that creates an
      analysis counts, including one that later fails, and a retry doesn't.
      At zero, the server refuses uploads, the upload page shows when uploads
      reopen, and the dashboard's "Review a new contract" button disappears.
      The dashboard's "Reviews left this month" counter replaced "Total
      reviews".
- [ ] **11. Email + password sign-in: setup only the user can do.** The code
      shipped 2026-09-24. Associates sign in with a password, and "Forgot your
      password?" emails a sign-in link that lands on `/account`, where they set
      a new one (at least 8 characters, audited as `password_set`; lowered from 12 by the user on 2026-09-26).
      - Done 2026-09-26: Supabase → Auth → Providers → Email minimum password length is 8, matching the app.
      - Set up custom SMTP (e.g. Resend) before real associates sign in.
        Supabase's built-in sender only reaches the project's own team, at 2
        emails an hour, so forgot-password links can't reach CD without it.
      - Demo account: add it with `scripts/seed-test-associate.ts <email>
        <name>` (it makes the account an admin), sign in once with
        `scripts/dev-login-link.ts`, then set the password on `/account`.
- [x] **12. Checks raised by the Rome review (2026-09-25, `965de927`, $0.36, 3m47s).**
      A second real contract (EMEA, euros, 73k characters) found gaps the app can
      close without the model:
      - The AI-use check no longer stops on a product name spelled out after its
        acronym, "RAPID! (Reservation Automated Processing …)". The §1.10.2 term
        list is unchanged.
      - Arithmetic checks read € and £, check two-column revenue summaries (its
        headline total was €5,000 more than its parts), and flag a payment
        schedule worked out on the tax-inclusive total when the contract says
        tax-exclusive.
      - Pictures at least 3 inches wide in the body are recorded in
        `intake_health.pictures`. The review screen notes each one, and the model is
        told not to infer what they hold. Rome's room block, rates included, was a
        picture the model never saw.
      - On `prompt/combined-run` only, unmeasured until the next Rome run (about $0.36):
        - A rule reads a deadline in days before arrival the right way round. Rome's
          review had proposed moving a 14-day cutoff to 21 days, which is worse for the group.
        - A `not_applicable` verdict covers clause types that can't apply, such as
          named storm away from hurricane regions, a damage deposit the contract never
          takes, or ADA by name outside the US.
        - Exposures work in the contract's currency. `deal_figures` asks for
          `group_rate` and `fb_minimum` as written, the checker reads €/£/$ amounts,
          and the card, the total and the client email show the right symbol. Rome's
          F&B gap works out to €13,000 by hand.
      - Still to do:
        - [x] Date checks (`lib/date-checks.ts`), done 2026-09-25. They flag
              schedule dates outside the event, a check-out on or before its
              check-in, and a date range that ends before it starts. Rome gets
              all three; Florida and the eval corpus get none. Numeric dates
              are read only when the contract shows whether it writes the day
              or the month first. The cutoff's "major arrival day" isn't
              checked, because a peak day after the first arrival is often
              legitimate.
        - [x] Pictures sent to the model (branch `prompt/picture-tables`,
              on `prompt/combined-run`, 2026-09-25). Each large picture whose
              image has at least 200×30 pixels and is PNG, JPEG, GIF or WebP
              goes after the contract text with a label, up to four a
              contract. Rome's room-block table is about 600 tokens ($0.001).
              A tiny icon stretched wide is skipped, which removes Rome's
              "Payment Breakdown" false alarm. The model is told not to quote
              a picture, because quotes are checked against the text, so
              app-computed exposures still don't use picture figures. The
              review screen says which pictures were read. Unmeasured until
              the next paid Rome run (about $0.36).
        - [x] The model's notes and the app's checks named the same problem
              twice. The review screen now hides a model note that shares two
              or more dates or amounts with an app check (2026-09-26).
        - [x] A cutoff finding that asks for more days before arrival than
              the contract gives is dropped with reason
              `moves_cutoff_earlier`. Both Rome runs proposed 14 → 21 days.
              The cause was CD's fallback wording, which fixed the cutoff at
              21 days while the position said "no earlier than 21 days". Both
              now say a cutoff 21 days or fewer before arrival meets the
              standard (2026-09-26, live table updated through the audited
              admin route, hash `ea1456de`). The library hash changed, so the
              next eval run needs a fresh baseline.

- [x] **Prompt rules for Rome run 2's misses — on `main` 2026-09-26, measured
      by the demo dry run on 2026-09-27 and kept** (`cb3daee0`, about $0.38,
      4m02s). Against `15e91734`:
      - Rate parity, mandatory fees and brand change each got a finding.
        All three had been lost to "meets".
      - Findings went from 37 to 38 and nothing was dropped. Output tokens rose
        from 24.7k to 26.8k.
      - A new F&B exposure of $45,000, $100,000 × (80% − 35%). It is checked
        against the cancellation schedule, whose last tier charges 80% of the
        F&B minimum. Total exposure went from $125,696 to $170,696.
      - A live property email draft on `15e91734` carried no dollar figures,
        exposure, severity, standards or rationale.

      Original entry: the prompt rules were measured by the next live run (the demo dry run). They cover:
      - a gratuity or service charge the contract doesn't charge is not applicable
      - meets needs a basis naming where the contract gives every required term
        (Rome's brand change and hotel cancellation; Florida's rate parity,
        mandatory fees and brand change in live run `15e91734`)
      - the event agreement and its terms and conditions are compared topic by topic
      - five more kinds of term outside the library
      - an attached picture's figures and dates are checked against the text
      Score the run against `15e91734`. If it's worse, revert the merge.

- [ ] **Re-reviewing the same contract without the model — decided, high
      priority, after the demo** (raised by the user 2026-09-26). An associate who
      uploads a contract the tool has already reviewed shouldn't pay for a second
      full review or spend an allowance on it. Build the two cases in this order.
      - **1. Same file again — build first. About half a day to a day. No model
        call, no migration.**
        - At upload, hash the accepted-view text. Look for a complete analysis by
          the same associate with the same hash, the same `standards_hash`, the
          same model and the same prompt version.
        - On a match, copy that review's findings, notes and the associate's
          decisions (accepted, edited, dismissed) into the new analysis. Record
          the source analysis in `intake_health`, and tell the associate the
          review was copied from their review of that date.
        - A changed library, model or prompt means a real re-review, because the
          old findings may no longer be what the tool would say.
        - The copy makes no model call, so it doesn't count toward the monthly
          limit (the allowance counts `token_usage.model_called_at`, done
          2026-09-26).
      - **2. The property's revised version (round 2 onward) — about 25–45
        hours.** This is MASTER_PLAN §2.1.2 plus the screens around it.
        - §2.1.1's round comparison is built. It finds what changed between the
          version CD sent and the one the property returned.
        - Sort each earlier finding without the model, by looking for CD's
          proposed wording in the returned text:
          - accepted: CD's wording now appears
          - rejected: the original wording is unchanged
          - countered: the wording changed to something else
        - Carry the associate's earlier decisions onto unchanged clauses.
        - Flag new wording the property added elsewhere, such as a concession on
          attrition paired with a tighter cancellation clause. Either the
          associate reads the flagged passages, or the model reviews only them,
          which costs a few cents rather than a full review's ~$0.37.
        - `finding_outcomes` already exists in the schema (migration `002`).
        - **Gate.** MASTER_PLAN holds §2.1.2 until the review's findings are
          proven accurate, because "the property rejected this" only means
          something once the finding is known to be right. Lifting that gate is
          the user's call.
      - **Open questions.**
        - How long does a prior review stay reusable?
        - Can associates reuse each other's reviews? That's a data-sharing
          question for CD.

- [x] **One card per clause** (user, 2026-10-04). Merged to `main`
      2026-10-04 (2513e48), from `ui/one-card-per-clause`.
      - A review asked for 34 to 65 separate decisions on cards covering 17
        to 24 clauses. Cancellation alone was six or seven cards, one per tier.
      - Findings on one clause now sit in one card under the clause's name.
        Every change still shows in full and keeps its own Accept, Edit and
        Dismiss, so the associate decides each one.
      - No control decides several changes at once (user, 2026-10-04). An
        "Accept all in this clause" button was built and removed the same day,
        because the associate should read and decide every change.
      - Clause cards are ordered by their most severe change. The keyboard
        steps through findings in the order on screen.
      - A clause with one finding shows as the plain card it always was. The
        Other section is unchanged.
      - No database change, and exports are untouched.
      - Checked live on Florida `4f803f16`: 50 business changes show as 24
        clauses, each change with its own Accept, Edit and Dismiss.

- [ ] **Dashboard tiles** (user, 2026-09-26). Keep "Reviews left this month" and
      "Reviews needing decisions". Replace "In progress", which is almost
      always 0, and "Completed this month", which now repeats the reviews-left
      count. The two replacements are still to be chosen.

- [ ] **Analytics tab — future, large build** (raised by the user 2026-09-26).
      Store the terms of every contract version, the final signed version above
      all, and let CD and its associates query that history. A new negotiation
      with a brand or property then starts from what CD got last time. The user
      sees this as a main selling point, since it turns the tool from a
      reviewer into a negotiation platform. It brings together MASTER_PLAN §2.7
      (property history), §2.8 (benchmarks) and §2.9 (exposure rollup).

      **Already built:**
      - Term catalog `hotel-v1` (`lib/terms/catalog.ts`, §2.0.2). It has 117
        terms: attrition, cancellation, cutoff, F&B, force majeure and more.
        Each one is checked against the contract text.
      - `contract_terms` table (migration `006`). It holds one row per term per
        analysis, and a term the contract leaves out is stored as `not_stated`.
        Extraction is switched off (`TERM_EXTRACTION`), so the table is empty.
      - Negotiation rounds (migration `004`) and the round comparison (§2.1.1).
      - `finding_outcomes` (migration `002`), which records whether the
        property accepted, countered or rejected each change. It is empty until
        §2.1.2 is built.
      - `deal_figures` (dates, room block, rates, F&B minimum), extracted by
        every review.

      **New pieces:**
      1. **Who the contract is with.** Add these terms: hotel name, brand,
         parent company, address, city/market and country.
         - A `properties` table, so that different spellings of one hotel
           ("JW Marriott Orlando" and "JW Marriott Grande Lakes") match to one
           record.
         - An associate confirms each new match once.
      2. **The final version.** Mark one version of a contract as signed. Its
         terms become the record the analytics use. A draft shows what was
         asked for. The signed copy shows what CD actually got.
      3. **Historical import.** Bulk-upload past signed contracts.
         - Extract terms only, with no review, since that's a much cheaper
           model call.
         - Price it before any import. At $0.10 a contract, 1,000 contracts
           cost $100.
         - Old signed copies are often scans. The app has no OCR, so a scan
           gives no text today.
         - "Training data" here means a reference database the app computes
           statistics from. No model is trained or fine-tuned.
      4. **The tab.** It has three views.
         - A property or brand profile: past terms, what they conceded and
           what they held.
         - Benchmarks, such as "this attrition is worse than 78% of CD's
           signed contracts in this market".
         - Exposure across open contracts, per associate or per client.
      5. **Insights in the review.** The review screen cites history beside a
         finding, for example "This property signed at 75% attrition in 2025."

      **Gates and open questions:**
      - **Data.** Bulk-processing real contracts needs CD's own Anthropic org.
        See CLAUDE.md deviation 7. That deviation covers one presentation, not
        a historical import.
      - **Sample size.** §2.8 says not to ship on 200 contracts. Every figure
        shows how many contracts it rests on, and nothing is shown below a set
        minimum.
      - **Accuracy.** Statistics use only `verified` and `located` terms.
        Extraction accuracy is measured against a hand-checked set before any
        benchmark is shown.
      - **Who sees what.** Decided by the user 2026-09-27: the tab is a
        firm-wide library.
        - Every associate sees every contract's terms and can open its term
          sheet.
        - Only admins see which associate negotiated a contract, and an
          associate always sees their own.
        - Each associate sees their results against all other associates,
          counted together.
        - The original file carries names and signatures, so it stays with its
          associate and admins unless `ANALYTICS_SHARE_ORIGINALS=on`.
      - **Missing is not zero** (the user, 2026-09-27). A term a contract
        doesn't state is missing, and every figure counts only the contracts
        that state it. The tab tracks only terms a contract states outright.
      - **Other companies.** If other firms use the tool, each firm's data stays
        separate. Pooling data across firms is a separate question, both
        commercial and legal.

      **Framework built on test data** (branch `feature/analytics-framework`,
      2026-09-27, deployed 2026-09-28 as 679eae3):
      - `/analytics`: filters in the URL, tiles, five charts (rate trend,
        attrition signed, what hotels give, average commission by brand,
        contracts signed by month), insights, and you against other associates.
        Admins also get the Associate filter and tables by associate, brand
        and client.
      - `/analytics/properties/[id]`: a hotel's contract history, what it
        gives, its brand's yearly rate trend, and its latest terms against its
        market.
      - Left out by the user's call (2026-09-27):
        - open exposure, which only grows and measures nothing
        - the firm-wide contract library, for now
        - the card showing how often each term is stated
        - negotiation rounds, which can't be measured reliably, and imported
          contracts arrive as a single round
        - days to sign, for the same reason: an imported contract has no
          first-draft date
      - Contracts are counted by the month they were signed, for the same
        reason.
      - Term sheet PDFs (`/api/analytics/term-sheets/[id]`) name no associate.
      - It stays hidden unless `ANALYTICS=on`. Test data needs
        `ANALYTICS_SOURCE=test`, and a production build also needs
        `ANALYTICS_DEMO=on`.
      - The test data is one file, `lib/analytics/test-data.ts`. Delete it
        and the "test" branch in `lib/analytics/source.ts` once real
        contracts load. Nothing is written to the database.
      - Later: the database source, public property details, and a map.

      **Order:**
      - Turn on term extraction and add the identity terms first. Every review
        from then on adds to the history, so the database grows before the tab
        exists.
      - Then build signed versions, then the import, then the tab.

      **Size:** roughly 120–200 hours, including the §2.7–§2.9 estimates. This
      is a first guess to firm up in planning.

- **Export and email button consolidation — §1.12, DONE** (8be8f09 for the Export
  picker, 8216b40 for the Email picker). Raised by the user 2026-09-09. The analysis header now carries six controls: Export memo, Draft
  client email, Export marked-up PDF, Export tracked-changes DOCX, Export proposed
  contract, Draft property email. Each was added on its own and the row is
  crowded and hard to read.
  Target, decided by the user:
  - **One Export button.** Opens a picker where the associate ticks one or more of
    memo, marked-up PDF, tracked-changes DOCX, proposed contract, each with a
    one-line description of what it is and who it is for. Existing preflight
    behaviour has to survive — the tracked-changes and proposed-contract paths
    both return a verdict before the file, and a refusal must still block that
    file while letting the others through.
  - **One Email button.** The associate picks client or property.
  **The user has overruled the standing objection to a single email control**
  (2026-09-09): §1.8.3's design kept the two audiences physically apart because
  one mis-set toggle sends CD's exposure figures to the counterparty. The user's
  call is that this is the associate's to manage. The server-side allowlist in
  `lib/email-drafting/property-assembly.ts` is unaffected and still guarantees a
  property draft can never contain severity, exposure or rationale — what changes
  is only which draft the associate asks for. The UI must therefore make the
  chosen audience unmistakable at every step, including the generated draft and
  the `.eml` filename.

- **Reject "no change needed" language at analysis time — not started.** The
  2026-09-09 fix holds these findings back from every export and both emails
  (`lib/proposed-language.ts`), which stops the damage but treats the symptom. The
  model should not return commentary in `proposed_language` at all. Wants a prompt
  constraint plus validation of the tool output in `lib/anthropic.ts`, and a
  decision on what the pipeline does when it sees one — drop the finding, or keep
  it with the language cleared so the associate still sees the clause was reviewed.

- **~~"No change needed" language reaches the redline and memo exports~~ — FIXED
  2026-09-09.** One shared predicate in `lib/proposed-language.ts` now holds these
  findings back from `getActionedFindings` (redline, memo, markup PDF, clean
  contract) and from both email assembly paths. `getActionedFindings` returns the
  held-back items rather than dropping them quietly, and every export route records
  the count in its audit metadata. Verified live against the real CD standard
  contract. Original note: §1.7.7 hit this and guards its own output, but the
  problem is upstream and shared. The model occasionally returns
  `proposed_language` that is commentary rather than clause text — "No change
  needed — retain as drafted." — and an associate can accept that finding. Every
  export path then treats it as replacement wording. The tracked-changes DOCX
  would insert it as a revision into the contract sent to the property, and the
  memo prints it as proposed language. Two of 335 findings in the dev database
  are like this, both on real analyses. Severity does not mark them out.
  Options, none chosen: reject such language at analysis time so it never reaches
  a finding; flag it in the review UI so an associate sees what they are
  accepting; or lift §1.7.7's guard into `lib/get-actioned-findings.ts`, which all
  three export paths already share. The last is the smallest change and the
  widest fix.


- **What the gate actually blocks (noted 2026-09-09, nothing acted on).** Raised by
  the user: senior-associate review is far off, standards are editable at any time,
  and the real CD standard contract already gets roughly 70% of the way there — so
  why does the gate stop so much? Three claims are being conflated, and separating
  them frees most of the work.
  1. *Can we change the standards?* Yes, already. The admin screen edits them, and
     migration `003` fingerprints the exact entries behind every analysis.
  2. *Does the machinery correctly apply whatever standards it is given?* Testable
     now, and largely tested — §1.4/§1.5/§1.6 verify document mechanics that never
     read a negotiating position.
  3. *Are CD's positions right?* Unknown, and only a senior associate can say.
  **Only (3) needs CD.** The gate is a claims-and-deployment gate, not a code gate
  — now stated in `MASTER_PLAN.md`'s Part 2 preamble:
  what it must stop is telling anyone "this is how ConferenceDirect negotiates" and
  putting the tool in front of real deals. It need not stop building machinery whose
  correctness does not depend on the positions being right. The build brief's gate
  language does not draw that line, which is why it reads as blocking everything.
  **The concrete missing 30% is visible in the code:** all 25
  `walk_away_condition` values in `lib/standards/v1.ts` are empty strings, and
  `position`/`severity_default` have never been checked against a real deal outcome.
  That is what the answer key buys. It is not more clause types.

- **Work that does not need CD — §2.0.1/§2.0.2/§2.0.3/§2.1.1, all four now done, last
  one 2026-09-20.** Numbered into `MASTER_PLAN.md` on 2026-09-09 and marked ungated
  there; 90-140 hours in total, noted "not started" at the time. In leverage order:
  1. **The eval harness — §2.0.1, Opus 5 · high. DONE 2026-09-09.** Built against a
     synthetic answer key, so CD's real key arrives as a data swap rather than a build.
     `lib/eval/` never imports the synthetic key and a test asserts it.

     What it measures is narrower than "is the tool accurate": the key derives from
     `lib/standards/v1.ts`, the same library the model reads, so a score says whether
     the pipeline **applies the standards it is given**. Whether CD's positions are
     right is still question 3, and still needs a senior associate.

     Ground truth is by construction. Contracts are written *from* a spec that already
     states every term, and a six-check gate refuses any draft whose prose drifted from
     it — including a read-back by a second model, because an obligation granted or
     denied has no literal handle to check. Findings are paired to key items by where
     they point in the document, never by clause name: pairing on the name would make
     "right issue, wrong name" score as a miss plus a false positive, and clause-name
     accuracy would read as perfect on exactly the findings that got it wrong.

     Corpus is seven contracts and 90 key items — enough for per-clause and
     per-severity breakdowns, not enough to read one percentage as a forecast. Eight
     more specs are written and held in `RESERVE_SPECS`. Recurring cost is about $1.50
     per measurement run; scoring itself is free and offline.
  2. **Term extraction — §2.0.2, Opus 5 · xhigh. BUILT 2026-09-11, not yet measured.**
     `docs/term-extraction.md` has the detail.
     - A separate pass reads 81 catalog terms as typed values (`lib/terms/`). Each value
       is checked against the document before storage. The quote must be in the text,
       and a figure must appear in its own quote.
     - Wired into `processAnalysis` behind `TERM_EXTRACTION=on`, off by default (the
       user's call). Migration `006` adds `contract_terms`, and is **not yet applied**.
     - The answer key is free: 525 stated values and 33 absent ones across the seven eval
       contracts. A perfect run built from it scores 100% against the real DOCX text.
     - **Measured on all seven (~$0.72 in total):** 524 of 524 stated values correct,
       and 32 of 34 absent terms left out. None were wrong or missed. There were 2
       silent-wrong values, both inventions: a room-block audit read into an attrition
       clause, and a zero derived from "no deposit". The prompt and catalog now address
       both, unmeasured. Checking eval-05 and eval-12 again costs about $0.18.
     - Four more flagged values turned out to be corpus defects the model read
       correctly. They're corrected in the key, each with its sentence.
     - **Open:** split `named_storm.cancellation_window_hours` into the forecast window
       and the notice window before a feature uses it. Then 8–13 real contracts, keyed
       by reading them, to reach MASTER_PLAN's 15–20.

     Original note: its own answer key was described as
     needing a senior
     associate, but verifying that a contract saying 90% was extracted as `0.90` is
     reading comprehension, not negotiating expertise — anyone literate can check
     it, and the 15 synthetic fixtures have known ground truth by construction.
     §2.0.2 is infrastructure whose correctness is independently checkable, so
     building it does not compound the damage the gate exists to prevent. The four
     dependent features (deadlines, what-if, savings, exec summaries) stay gated.
     **This was a deviation from "nothing in Part 2 starts until the gate clears";
     the user accepted it on 2026-09-09 and `MASTER_PLAN.md` now states it directly.**
  3. **Diff mechanics — §2.1.1, Opus 5 · xhigh. DONE 2026-09-20.** See the full entry
     above (Open items) for what it does and what it found. The reconciliation into
     `finding_outcomes` is still §2.1.2 and stays gated, because "the property rejected
     this finding" only means something once the finding is known to be right —
     `finding_outcomes` itself turned out to already exist as a real table (migration
     `002`), so §2.1.2 needs a writer, not a migration.
  4. **Deploy** — still local-only, needed regardless. A 2026-09-19 hosting audit
     found the app already returns 202 and polls for status (build brief §5) —
     the browser never holds a request open for the 3-5 minute review. The gap
     is that the background continuation runs via `after()` inside the same
     serverless invocation that answered the request, so *any* platform's
     function-duration ceiling becomes the review's ceiling. Vercel Pro ($20/mo)
     would raise that ceiling to 300s — still uncomfortably close to a 5-minute
     run. Recommendation: Render (or Fly/Railway), a real persistent Node
     process with no such ceiling at all, at zero required app-code change.
     Cloudflare Workers+Queues and Netlify Background Functions were both
     evaluated and ruled out for now — Cloudflare's Node compatibility is a real
     open risk given this app's document-processing dependencies
     (`mammoth`/`pdf-lib`/`jszip`/`word-extractor`/`pdfjs-dist`), and Netlify's
     background-function model needs the job-dispatch code restructured rather
     than trusting `after()` to route there automatically.
  5. **The §1.5 table-quote follow-up** below — narrow, but tables carry the money.

- **Portability: retooling for a different client — §2.0.3, DONE 2026-09-11.**
  Retooling for another firm in the same space now means editing `ORG` in `lib/org.ts`
  and loading that firm's standards. No other code changes.
  - **Org name.** `lib/org.ts` exports an `OrgProfile` (full name, short form, one-line
    description). All four prompt sites, the client email tool schema and the UI read
    it. `tests/prompt-golden.test.ts` pins the exact request each model call sends,
    and those goldens passed unchanged, so every CD review sends what it sent before.
  - **Taxonomy.** `StandardEntry.clause_type` is a plain `string`. Nothing had narrowed
    on the old union. Two tests on the bundled library replace its typo check.
  - **Acceptance test.** `tests/portability.test.ts` runs an invented client, whose
    clause types share nothing with the hotel library, through analysis, redline,
    the validation oracle, the memo and both emails. The model is mocked. The oracle
    passes clean and no request names CD. No paid run was needed.
  - **Still industry-specific, by design.** The prompts say "hotel or venue" and
    "property". The eval synonym map in `lib/eval/match.ts` and the table warning in
    `lib/docx/health.ts` assume hotel clauses. Another vertical would need prompt
    re-tuning against measured runs, which a parameter cannot replace.
  - **Internal names kept.** The `cd_standard` column, the `cd_validated` provenance
    value and the `--cd-*` CSS variables. Users see none of them, and renaming
    `cd_standard` in the tool schema would change model output.

  The original note follows. Raised by the user — if CD does not buy, how cheaply can this serve another
  company in the same space? Most of the answer is already good. Three layers, and
  today only the third is client-specific:
  | Layer | Example | Scope |
  |---|---|---|
  | Document mechanics | extract, locate, redline, validate, export | client- and industry-agnostic |
  | Clause taxonomy | attrition, cancellation, force majeure exist in any hotel contract | industry-specific |
  | Negotiating positions | `position`, `fallback_language`, `walk_away_condition`, `severity_default` | client-specific |
  Layer 3 already lives in the `standards` table with provenance and versioning, and
  `clause_type` is unconstrained `text` in the database — so the schema is portable
  today. Two seams are not yet clean:
  - **`ClauseType` is a compile-time union of 25 hotel clause types**
    (`lib/standards/types.ts`), fusing layer 2 into the build. Fine for another
    hotel-side client; wrong for another vertical.
  - **"ConferenceDirect" is hardcoded in four prompt sites** in `lib/anthropic.ts`
    (analysis tool description, analysis system prompt, both email prompts) plus UI
    copy. The cost of this grows with every new prompt site — there were three
    before §1.8.3 added the fourth. Parameterising the org name is cheap now and
    gets steadily less so.
  A useful acceptance test for the split, whenever it is done: **the pipeline should
  run end to end against a dummy standards set and still produce structurally valid
  output.** If it cannot, layers 1 and 3 are still entangled.


- **DOCX-to-preview pipeline — DONE, 2026-09-08.** Was scoped and folded in as
  `MASTER_PLAN.md` §1.4a on 2026-09-07; built, verified, and merged the next
  day. See the §1.4a entry in the stage log above for what shipped and what
  was verified.
  The diagnosis: the preview is bad because the code *discards structure*, not
  because the conversion is imprecise. `document-conversion.ts` calls
  `mammoth.extractRawText`, dropping every heading, table and list before
  `text-to-pdf.ts` re-flows the remains. Cancellation schedules and attrition
  sliding scales are tables, and they carry the largest dollar exposure in the
  contract — so they reach *the model doing the analysis* as flattened prose.
  That makes this an accuracy problem before a UI one.
  The fix: §1.4 must build a character-to-source-node map regardless. Render the
  preview as HTML from that map instead of converting to a PDF. Highlighting
  becomes an exact offset lookup rather than fuzzy coordinate matching, and
  `line-positions.json`, the `text-to-pdf` reflow and `get-positioned-lines`
  all retire for DOCX-sourced analyses. Genuine PDF uploads keep the pdfjs viewer.
  A LibreOffice or hosted conversion was considered and **rejected**: it would
  cost roughly $2-4/month, but the real objection is that it adds another vendor
  account for CD to inherit at handoff (master plan §4.7) to solve a problem
  solvable for nothing. The earlier no-heavy-dependency decision therefore stands.
  Tradeoff accepted: the preview will not match the property's exact fonts and
  page breaks. That never mattered — the file sent back to the hotel is the
  tracked-changes DOCX, byte-identical outside changed spans.

- [x] **§1.7.7 Clean "as revised" contract export (2026-09-09).** The user's idea
      from 2026-09-08, numbered and built. A separate export rendering the contract
      as it would read if the property agreed to every accepted change — no
      strikethroughs, no markers. Delivered as its own button rather than appended
      to the marked-up PDF, so that output stays byte-identical and a 40-page
      contract does not become 85 pages for someone who only wanted the changes.
      Text is reconstructed from the same positioned lines the marked-up PDF uses,
      and spans are located with §1.5's `locateQuote`, so the two exports cannot
      disagree about where a finding sits and an ambiguous quote is refused rather
      than applied to whichever clause came first. `locateQuote` only ever read a
      part's name and text, so its parameter widened to a structural shape;
      `WalkResult` still satisfies it and §1.5 is untouched. New clauses are
      appended under their own heading; anything that could not be placed is listed
      after them with its language, and the body keeps its original wording.
      **A content-conservation gate** reads the rendered PDF back and compares it
      against the text it was built from, on letters and digits only, since
      extraction merges adjacent lines and the renderer substitutes glyphs it
      cannot encode. Two independent splice implementations must also agree, which
      is the §1.4/§1.5 offset-bug check. A failure refuses the download and says
      why. Quality bar agreed with the user: content, not layout — spacing may
      differ, nothing may be missing.
      **The gate found four pre-existing defects in shared code**, two of them
      silently corrupting the existing DOCX conversion path. `lib/text-to-pdf.ts`
      checked for page space once per paragraph, so every line of a paragraph
      taller than a page was drawn off-canvas and lost; and a token wider than the
      text column was drawn past the right page edge. Both have been losing text in
      DOCX and DOC conversion since before this section. Also fixed here: footnote
      markers sorting ahead of their line, a sparse page destroying paragraph
      detection, and running headers surviving whenever the page number changed.
      **Found live, against the real CD standard contract**: one accepted finding's
      proposed language was "No change needed — retain as drafted.", and applying
      it replaced a live rate-parity clause with that sentence — a finished-looking
      contract, bound for the property. Such language is now listed rather than
      applied. Severity cannot spot these; 2 of 335 findings in the dev database
      look like commentary and they are "low" and "note", while other "note"
      findings carry real clause text. **This affects the redline and memo exports
      too and is not fixed there — see the open item below.**
      Findings cross into the document through a narrowed type carrying only
      clause, section, quote, language and the missing-clause flag; severity,
      `finding_text` and `cd_standard` cannot reach it, the same rule §1.8.3
      applies to the property email.
      Verified against six real analyses across both source formats, including a
      504-line genuine PDF and the 290-line CD standard contract, all passing the
      content check with no excluded field in any output. 113 tests for the
      section, 420 across the suite.

- **Superseded by §1.7.7 above.** Original note, 2026-09-08: Idea raised by the user during §1.7 work, 2026-09-08: append a
  third section to the marked-up PDF, after the cover-page change table and
  the annotated redline — a divider page reading "Proposed Amended Contract,"
  followed by a clean render of the contract with every finding's proposed
  language already applied in place, no strikethroughs or margin marks. A
  client or the property opening the file would then see three things in
  order: what changed, the redline itself for context, and what a signed
  version would actually read like.
  This builds on what §1.7 already has. For DOCX/DOC-sourced text, the PDF is
  drawn by CD's own renderer (`lib/text-to-pdf.ts`) rather than parsed from a
  foreign file, so splicing each finding's `quoted_text` for its `language`
  and re-flowing through that same renderer is a plain text substitution —
  much simpler than the DOM surgery `lib/redline-engine/` needs for real
  Word tracked changes. Real open questions, not yet resolved: whether this
  lives inside `generateMarkupPdf`'s single output or as a separate opt-in
  export; what a finding whose quote couldn't be located should do in the
  clean version (omit it silently, or flag the omission somewhere); and
  whether it's worth building for the export-fallback case (§1.6.4) at all,
  since a `.docx` that failed export validation might have quirks in its
  extracted text that a clean rewrite would just reproduce. Scope this as
  its own small plan-mode pass, same as the cover-page work, before starting.

- **Contract revision chains — not started, worth exploring.** Today each
  upload is an independent analysis with no relationship to any other. Real
  negotiations aren't single-shot: an associate sends requested revisions to
  a property/client, the property sends back a revised contract, and right
  now that revised version has to be uploaded as a brand-new, disconnected
  analysis — there's no way to see what changed between rounds, what the
  property actually fixed, what's still open, or whether they introduced
  anything new. The idea: let an associate mark a new upload as a revision of
  a specific prior analysis, then show a comparison view — per clause type,
  resolved (flagged in the old version, no longer flagged now) / still open
  (flagged in both) / new in this revision (flagged only in the new version —
  arguably deserves *more* scrutiny than a first-pass finding, since it's
  something the property introduced or changed between rounds, not something
  original to the contract).
  Some of this is more tractable than it sounds because of pieces that
  already exist: every finding already keys off a stable `clause_type` (19
  categories) rather than free text, which is a natural join key across two
  analyses' findings without needing any fuzzy text diffing; `finding_actions`
  already records what the associate asked for per finding (accept/edit,
  with the edited language) with full audit attribution, which is exactly
  the "what did we request" side of the comparison; `analyses.client_id`
  already links analyses to a client, though that alone isn't enough to infer
  a chain (one client can have several unrelated contracts over time, not
  just revision rounds of the same negotiation) — an explicit link is needed,
  not inference from client alone.
  Real open questions, not yet resolved: how the associate indicates "this
  upload is a revision of that one" (an explicit picker at upload time is
  almost certainly simpler and more reliable than trying to auto-detect it
  from filename/content similarity — worth deciding deliberately rather than
  reaching for a heuristic); whether clause-type-level matching is enough
  granularity or associates will want to see *how* the language itself
  changed within a still-open clause (the former is a much smaller feature —
  reuses existing structured findings as-is; the latter is closer to a real
  text-diff feature and a bigger lift); the data model needed to actually
  link analyses into a chain (e.g. a `previous_version_id` column) and the
  new comparison screen/view to surface it — neither exists today. Scope this
  properly (likely its own plan-mode pass, similar to the redline export
  effort) before starting; don't fold it into a smaller ticket.

- **Drag-and-drop file upload — done.** The upload screen
  (`app/(app)/upload/page.tsx`) now wraps the existing file `Field` in a
  dropzone (`onDragOver`/`onDragLeave`/`onDrop`) that sets the same `file`
  state the native "Choose File" picker's `onChange` already did — an
  *additional* affordance alongside click-to-browse, not a replacement, so
  keyboard/screen-reader users keep the same working path. Shows a dashed
  blue border + tint during drag-over and a "Selected: <filename>" line once
  a file lands. No new client-side validation was added — server-side
  `detectSourceFormat`/32MB check in `app/api/analyses/route.ts` is the
  actual gate either way, so a dropped oversized/wrong-type file fails the
  same way a picked one already did. Verified in-browser: drag-over toggles
  the highlight, and a dropped file populates state and enables "Start
  review" without touching the native input.

- **Modern SaaS visual redesign — done.** Follow-up to the UI/UX refinement pass
  below, after the user pointed out that pass was mostly invisible at a glance
  (real bugs and accessibility fixes, but the same visual language). Three
  directions were sketched and shown live as mini finding-card mockups —
  Refined Minimal (safe polish), Modern SaaS (sidebar nav, bolder color-blocked
  badges — chosen), Dense Professional (power-user density) — the user picked
  Modern SaaS for maximum visual impression ahead of presenting to
  ConferenceDirect. No build brief file, brand guideline, or design-system
  source exists anywhere in the repo beyond `app/globals.css`'s CD navy/blue
  palette (confirmed via a full repo search) — this redesign extends that
  palette, it doesn't invent a new one.
  Replaced the top nav bar with a persistent left sidebar
  (`components/sidebar-nav.tsx`, `components/nav-links.tsx` for the shared
  link-list/icon/footer markup reused by both the sidebar and the mobile
  drawer) — `components/nav-bar.tsx` is gone, replaced by this plus
  `components/mobile-top-bar.tsx` below `lg`. This forced a genuine fix,
  not just a rename: the review screen's `NAV_HEIGHT`/`SUBHEADER_HEIGHT`
  hardcoded-pixel viewport-height math (flagged as fragile but deliberately
  deferred in the prior pass) had no equivalent constant to compute once
  there's no desktop top bar at all — replaced with a proper flex-based
  full-height shell (`app/(app)/layout.tsx` is now `h-screen` + sidebar +
  scrollable `<main>`, `app/(app)/analyses/[id]/page.tsx` is now `h-full`
  flex throughout) instead of `calc(100vh - Npx)` subtraction. Added filled
  pastel-pill severity badges (`components/ui/status-pill.tsx` now accepts an
  optional `style` prop for the one caller — severity — whose color comes
  from a runtime lookup rather than a static className, since Tailwind can't
  generate a class from an interpolated value) alongside a thinner card-left
  accent border, not instead of it — color is still never the only signal.
  `components/ui/card.tsx` gained an `elevated` variant (shadow instead of
  border, for stat tiles only — list/table surfaces stay flat-bordered so a
  dense page doesn't look busy) and `components/ui/button.tsx` gained a
  `gradient` variant reserved for the one hero-CTA use case (dashboard's
  "Review a new contract"). Bumped `rounded-md` → `rounded-lg` on `Card`/
  `Button`, and page `h1`s one step up the type scale.
  **Verified live**: sidebar renders and every route is reachable at desktop
  width; the mobile drawer (same open/close/`aria-expanded` mechanism from
  the prior pass's nav, re-housed) opens/closes and reaches every route;
  computed styles confirmed the gradient CTA, the shadow token, and the
  8px/`rounded-lg` radius are genuinely applied, not just visually plausible;
  confirmed no page-level horizontal overflow at mobile width on the
  standards and review screens (`document.body.scrollWidth === window.innerWidth`)
  despite the chunkier pill badges looking visually tight in a screenshot at
  that width — not a real bug, just cosmetically snug on a long provenance
  label; the review screen's new flex-based height fix fills the viewport
  correctly with no clipping or gap, replacing the removed pixel-math
  entirely rather than just updating the constants.
  **Not attempted this pass, worth a follow-up**: the review screen's
  subheader row (findings count + 3 export buttons) doesn't responsively
  wrap on narrow viewports and looks cramped there — pre-existing from before
  this redesign, not a regression it introduced, but not fixed either.

- **UI/UX refinement pass — done.** Full audit of all 13 UI files ahead of presenting
  to ConferenceDirect and its associates. Fixed real bugs and structural gaps rather
  than reskinning: an unhandled-rejection bug in `app/auth/callback/page.tsx` that
  stranded users forever on "Signing you in..." on an expired magic link (the exact
  case its own error copy was written for); a completely unreachable mobile nav
  (`components/nav-bar.tsx` was `hidden sm:flex` with no hamburger/drawer at all,
  now has one, plus `aria-current`/active-link styling); all 7 unassociated form
  labels sitewide (`<label>` with no `htmlFor`/`id` pairing, login's email field had
  no `<label>` at all); a real WCAG AA contrast failure (`--text-muted`/`--severity-note`
  at ~3.1:1 on white, now ~5:1). Introduced a small shared `components/ui/` primitive
  set (`Button`, `Field`/`FieldInput`/`FieldTextarea`/`FieldSelect`, `Card`,
  `StatusPill`) to collapse 4+ inconsistent hand-rolled button recipes and make
  label association structural going forward rather than a one-time cleanup;
  migrated all 13 files onto it. Added a dependency-free toast confirmation system
  (nothing existed before — every save/action was silent), loading skeletons
  (`app/(app)/loading.tsx`, a PDF-viewer spinner), and branded `app/error.tsx`/
  `app/not-found.tsx` in place of bare Next.js defaults. Enabled
  `jsx-a11y/label-has-associated-control` in `eslint.config.mjs` so the label-gap
  class of regression can't silently return.
  **Verified live**: keyboard/label-association checks via the accessibility tree
  (not just visual screenshots) on login/upload; mobile hamburger nav opening,
  closing, and reaching every route with correct active-state highlighting; toast
  confirmations firing on finding accept/edit/dismiss and on a standards-library
  save; the branded 404 page; the PDF viewer's loading spinner. One real false
  alarm during testing, worth recording: toast confirmations appeared to silently
  fail after an awaited `fetch()`, which cost significant debugging effort chasing
  a suspected React/Next.js interaction bug — it turned out to be pure dev-server
  compile latency in this session's testing (a fresh, actively-recompiling Turbopack
  process needs several seconds to settle per interaction, not the sub-second
  windows initially assumed), not a real defect. No workaround was needed once
  waits were long enough; don't re-introduce one without re-confirming the bug is
  real first.
  **Deferred to a backlog, not attempted this pass** (all genuinely lower-urgency
  than a first presentation, not correctness gaps): dashboard pagination (hardcoded
  `.limit(12)`, no "view all"); standards-library search/filter (fine at 19 entries,
  won't scale); a confirmation step before saving a standards edit (the data-layer
  safeguards — the self-clearing validation stamp and audit log — already exist;
  this would be a UI affordance on top, not a data-integrity fix); dark mode;
  a real retry-analysis mechanism (today "Try again" on a failed analysis just
  links to a blank upload form, not a true retry of the same file); the dashboard's
  one `<table>` has no mobile-specific treatment (no `overflow-x-auto`, no
  `truncate` on long filenames) — currently tolerable at 4 short columns but
  untested at real-world edge cases.

- **Custom PDF viewer with in-place clause highlighting — done.** The review screen's
  `<iframe>` (browser-native PDF display, page-jump only) is replaced with
  [`pdf-viewer.tsx`](app/(app)/analyses/[id]/pdf-viewer.tsx): a canvas-based viewer
  using `pdfjs-dist` (a genuinely new dependency — `unpdf`'s internal pdfjs build is
  server/edge-oriented, not reusable for a browser worker), with prev/next page
  controls and a "Download original" link replacing the native chrome that was lost.
  Highlight rects are computed on demand (no schema migration, no persisted bounding
  boxes) by a new `GET /api/findings/[id]/highlight` endpoint, reusing
  `getPositionedLines()`/`findMatchingLineIndices()` unchanged and adding
  `findHighlightRects()` to [`lib/locate-text.ts`](lib/locate-text.ts) — it merges
  adjacent matched items into per-line boxes (guarded by page + baseline-y + a bounded
  horizontal gap, so two items sharing a y in different table cells/columns don't get
  bridged into one box). Clicking a finding sets the page immediately and fetches/caches
  highlight rects separately, so page-jump keeps working even if a highlight can't be
  computed — exactly like the existing "location not pinpointed" case. Real security
  catch during the build: `npm install` flagged `pdfjs-dist@5.6.83–6.2.108` as a
  disclosed high-severity arbitrary-JS-execution-from-a-malicious-PDF vulnerability,
  which lands squarely in this app's threat model (associates upload contract PDFs
  from outside parties) — pinned to the patched `^6.3.289` instead.
  **Verified live**: uploaded a fresh DOCX-sourced and a fresh PDF-sourced synthetic
  contract, clicked findings on both, confirmed multi-line highlight boxes land
  tightly on the correct clause text (line-level merge for DOCX/DOC, word-level merge
  for genuine PDFs), rescale correctly on window resize, and don't re-fetch on a
  repeat click of the same finding; confirmed the pre-existing "not pinpointed"
  fallback and older (pre-dating this feature) analyses still render correctly.
  **Not verified**: the multi-column/table PDF edge case the merge guard exists for —
  no adversarial sample available yet, same open gap as Phase B of the redline export
  (see below).

- **Location transparency + click-to-page navigation — done.** Two gaps from the
  redline work being export-only: the tracked-changes DOCX appendix used to lump
  "clause doesn't exist" and "clause exists but couldn't be pinpointed" into one
  heading (fixed — `lib/tracked-changes-docx.ts` now emits two distinct sections);
  and the review screen had no way to show whether a finding would actually get
  marked up before export (fixed — `location_page` is now computed once at analysis
  time in `lib/analysis-pipeline.ts`, reusing the exact-match logic extracted into
  `lib/locate-text.ts`, and surfaced per finding as either a clickable "Page N"
  affordance or an honest "location not pinpointed" caveat). Clicking jumps the PDF
  iframe to that page via the `#page=N` fragment. Verified: uploaded a fresh DOCX,
  confirmed `location_page` populated correctly for locatable findings and left
  `null` for missing-clause ones; confirmed the caveat renders for a simulated
  unmatched case; confirmed the split appendix headings in a real tracked-changes
  DOCX export.

- **Redlined/tracked-changes export (both PDF and DOCX)** — requested explicitly
  (competitor parity). Full scope at
  [docs/redline-export-plan.md](docs/redline-export-plan.md) (three phases, ordered
  by risk). Status:
  - [x] **Phase A — marked-up PDF for DOCX/DOC-sourced analyses.** Done. Key insight:
    since we generate that PDF ourselves ([`lib/text-to-pdf.ts`](lib/text-to-pdf.ts)),
    it now also records exactly where every line landed, so a finding's quoted text
    is found by exact match — no fuzzy PDF text-extraction needed, no schema
    migration. [`lib/redline-pdf.ts`](lib/redline-pdf.ts) draws the strikethrough +
    numbered margin markers + a "Redline Notes" appendix (missing-clause findings
    collected under "Requested Additions"). Verified end to end against a real
    generated DOCX: multi-line strikethrough spans, marker placement, and the
    appendix all confirmed correct on inspection.
  - [x] **Phase B — marked-up PDF for genuinely PDF-sourced analyses.** Done, for
    standard single-column layouts — verified against a real PDF-native contract on
    the first attempt (after fixing a real bug: `unpdf` detaches the buffer it's
    given, corrupting `pdf-lib`'s copy of the same bytes). Turned out simpler than
    planned: [`lib/extract-pdf-lines.ts`](lib/extract-pdf-lines.ts) via `unpdf`
    returns positioned text in the same shape Phase A already produces, so the
    existing exact-match code in `lib/redline-pdf.ts` works unchanged — no new fuzzy
    matching needed. **Still unvalidated**: multi-column layouts, tables, and
    scanned/image-based pages, where a PDF's content-stream order can depart from
    reading order. The not-found fallback (skip + list in appendix) is the safety
    net for that case but hasn't been stress-tested against a real adversarial
    layout yet.
  - [x] **Phase C — tracked-changes DOCX.** Done, DOCX-sourced only (no Word document
    to inject revisions into for PDF- or DOC-sourced analyses).
    [`lib/tracked-changes-docx.ts`](lib/tracked-changes-docx.ts) uses `jszip` +
    surgical string-splicing of `word/document.xml` — deliberately not a generic
    XML-tree rebuild, to avoid producing a file Word can't open. The same exact-match
    approach from Phases A/B turned out to work here too — no fuzzy matching needed.
    **Verified**: valid well-formed XML, correct `<w:del>`/`<w:ins>` content and
    author/date attribution on direct inspection, and a full round-trip through
    `mammoth` that correctly resolves to the "accepted changes" reading. **Not
    verified, and can't be from this environment**: whether Word's Reviewing pane
    actually renders these as accept/reject-able suggestions with the right styling —
    needs a human opening the file in real Word or Google Docs.
  - **Open gap: legacy `.doc` uploads have no same-format redline output.** DOCX-sourced
    and PDF-sourced analyses both already round-trip in their original format (DOCX
    tracked-changes for the former, marked-up PDF operating on the real original file
    for the latter) — `.doc` is the one source format where the redline export (PDF)
    doesn't match the import format. Not a straightforward fix: `.doc` is Microsoft's
    old binary Word format (OLE2/Word Binary File Format), not XML, so it can't be
    string-spliced the way [`lib/tracked-changes-docx.ts`](lib/tracked-changes-docx.ts)
    handles real `.docx`. The realistic options are Apache POI (Java) to write the
    binary format directly, or converting `.doc`→`.docx` via something like LibreOffice
    headless first — the same "heavy binary dependency, awkward on Vercel" tradeoff
    already rejected once for the DOCX upload-conversion step. Not impossible, but a
    real infra cost this project has otherwise avoided; low priority unless real usage
    shows associates uploading legacy `.doc` files often (DOCX has been Word's default
    since 2007).

- **Standards library breadth vs. depth — significant progress, still not the
  validation gate.** The library now covers 25 clause types (19 original + 6
  added below) and 20 of the 25 are `provenance: extracted` rather than
  generic `industry_default`, sourced from a real CD document: "ConferenceDirect
  Ideal Standard Contract (REVISED 2013)," provided directly by the user. Both
  `lib/standards/v1.ts` (what the model actually reads — see the wiring note
  below) and the live `standards` DB table (what the admin screen shows) were
  updated together so the two stay in sync. 14 of the original 19 entries were
  rewritten with real language/numbers from that document (e.g. attrition's
  threshold changed from a generic 80% to CD's actual 70%-cumulative formula
  with a 95%-occupancy full-credit day; cancellation's mitigation/resale-credit
  and rebooking-credit mechanics; fb_minimum's real 35%-of-shortfall penalty
  instead of a flat fee). 5 entries (`cutoff_date`, `damage_deposit`,
  `assignment_subcontracting`, `named_storm`, `attendee_data_handling`) were
  deliberately left as `industry_default`, unedited — the source document
  said nothing usable for them, and stamping them "extracted" anyway would
  overstate what's actually backed by a real CD position (the whole point of
  the provenance field). One entry (`attrition`) was already `cd_validated` in
  the live DB from earlier session testing of the admin save flow (not a real
  associate sign-off) — user confirmed overwriting it to `extracted` with the
  new content rather than leaving stale text under a "validated" stamp.
  6 new clause types were added because the source document covered them
  substantively and nothing previously checked for them at all:
  `ada_compliance`, `governing_law_venue`, `labor_disputes`, `rate_parity`,
  `gratuity_service_charge`, `resale_mitigation_duty`.
  **Real architecture finding surfaced during this work — FIXED 2026-09-07**:
  the analysis pipeline never read the `standards` DB table. `lib/anthropic.ts`
  imported `STANDARDS_LIBRARY` straight from `lib/standards/v1.ts`, so the DB
  table and the admin screen built for it (item 7 above) were a seeded mirror
  wired to nothing downstream — an admin could edit an entry, see it save, and
  change nothing about how contracts were reviewed.
  Now: `lib/standards/load.ts` reads the table, and `analyzeContractPdf` takes
  the library as a required argument rather than importing it, so no call site
  can silently fall back. The bundled array stays as seed and fallback (a
  transient DB problem shouldn't fail an analysis) but that path is recorded in
  `analyses.standards_source` and warned about, never silent — build brief §14.
  This also needed a traceability fix. 001's schema comment says
  `library_version` exists so a finding is traceable to the exact library that
  produced it, but every row shares the version string `v1-industry-default`
  (it is the seed script's upsert conflict key), so an admin edit changes
  content while leaving the version identical. Migration `003` adds
  `standards_hash` — a SHA-256 of the exact entries sent — alongside
  `standards_source`.
  Verified live: 25 entries load from `database`, hash identical to the bundled
  library, so the change is behaviour-neutral until someone actually edits a
  standard. `npm run standards:status` reports that comparison, since the two
  can now legitimately diverge.
  **Verified live, end to end**: extended `scripts/generate-sample-contract.ts`
  with two new deliberately-unfavorable sections (a Delaware/Wilmington
  governing-law clause; an undifferentiated 22% service charge) so all 6 new
  categories had something to check against, regenerated the fixture, and
  uploaded it through the real `/api/analyses` endpoint under an authenticated
  session. All 25 clause types appeared in `clauses_checked`; every new
  category produced a correct finding — `ada_compliance`, `labor_disputes`,
  `rate_parity`, and `resale_mitigation_duty` correctly flagged as missing,
  while `governing_law_venue` and `gratuity_service_charge` were correctly
  identified as present-but-unfavorable rather than missing, proving the
  model distinguishes the two. Findings on unchanged categories cited the new
  real numbers verbatim (e.g. "CD's cumulative, 70%-threshold, 70%-of-rate
  standard"), confirming the model is reading the updated file, not a cached
  prompt.
  Breadth and depth both moved meaningfully with this real CD document, but
  this is still not the validation gate: no named senior associate has
  reviewed this against real deal outcomes, so nothing here should be
  presented as "how ConferenceDirect negotiates" until that happens (build
  brief §10.2, §15 item 3, and the "Real answer key" item below) — this gets
  CD roughly 70% of the way there by the user's own estimate, not to 100%.

- **Real answer key** (build brief §10.2) — blocking for pilot. Needs a senior
  associate to review 25-30 of CD's past executed contracts cold and record what
  they'd flag, before seeing any tool output.

- **CD's Anthropic organization** (build brief §4.1, §15 item 1) — needs to be
  opened before the first real (even redacted) CD contract is processed.

- **Client confidentiality review** (build brief §15 item 2) — determines whether
  redaction is required before CD's executed contracts can be used to build the
  stage-2/3 library. Note on scope: a competitor (EventNation) leads with client-side
  PII stripping as their core trust feature, since they're a multi-tenant SaaS
  serving many unrelated companies who don't trust each other or the vendor with raw
  contract data. That reasoning doesn't transfer here — this tool is single-tenant,
  built for and used only by CD, so there's no cross-customer trust boundary to
  protect against in the same way. This item stays open only because of CD's own
  compliance question (does CD's data-handling commitment to *its* clients require
  redaction before their contracts reach any third-party model provider) — a distinct
  question from the competitive one, not resolved or closed by it.

- **Named senior associates for library validation and the answer key**
  (build brief §15 item 3) — the resource ask that gates stage 2/3 of the library
  and the real accuracy gate.

- **CD security environment integration** (build brief §4.2, §15 item 4) — SSO/IdP,
  hosting requirements, review process. Deferred by design; not needed for the pilot.

- **Who owns this after handoff** (build brief §15 item 5) — named maintainer,
  time allocated.

- **Platform benefit vs. sold product** (build brief §15 item 6) — CD's call with
  counsel/insurance; affects "not legal advice" framing if it changes.
