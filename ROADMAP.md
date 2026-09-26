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
      existed only to exercise it; Stage 0's findings stay in
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

### Deploy and client-presentation readiness (2026-09-22, high priority)

A client presentation is expected this week. Item 13's redesign (above) is done;
this is what's left before someone outside CD sees the tool. See CLAUDE.md's
Agreed deviations item 7 for the data-handling decision behind item 7 below.

- [ ] **1. Deploy to Render.** Web service connected to GitHub, `npm run build` /
      `npm start` (unchanged commands, no code change needed). Set the five env
      vars from `.env.local` in Render's dashboard. Verify `postinstall`
      (`scripts/copy-pdf-worker.mjs`) runs in Render's build. Supersedes the
      Vercel-Pro note elsewhere in this file — see the 2026-09-19 hosting audit.
      Node is pinned to 24 in `.node-version`, which Render and CI both read.
      Checked locally on 2026-09-25 on `prompt/combined-run` (39898ce):
      `npm run build` passes with no warnings, and `npm start` served sign-in,
      the dashboard, upload, account, standards, a DOCX and a PDF review, and
      all four exports with no server errors.
- [ ] **2. Starter tier ($7/mo), not Free.** Free spins down after 15 minutes
      idle with a 30-60s cold-start wake on the next request — a real risk if
      the app is opened cold in front of the client.
- [ ] **3. One full smoke test on the deployed instance**, before anyone else
      sees it: login, upload, a real analysis end to end, review, export, draft
      an email.
- [ ] **4. Clean up the demo account.** The dashboard currently shows a dozen
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
      Still to do: repeat these checks on Render once it's deployed.
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
      a new one (at least 12 characters, audited as `password_set`).
      - Supabase → Auth → Providers → Email: set the minimum password length to 12.
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

- [ ] **Repeat reviews without a model call — scoped, not started** (raised by
      the user 2026-09-26). An associate who uploads a contract the tool has
      already reviewed shouldn't pay for, or spend an allowance on, a second
      full review.
      - **Same file again.** Hash the accepted-view text at upload. When a
        complete analysis by the same associate has the same hash, the same
        `standards_hash` and the same prompt version, copy its findings and
        notes into the new analysis instead of calling the model. A changed
        library or prompt means a real re-review, so those must match.
      - **A revised version (round 2 and later).** §2.1.1's diff already
        finds the changed passages between rounds. Carry over the prior
        round's findings on unchanged clauses, and send the model only the
        changed clauses. That cuts cost, but it still makes a call.
      - **Allowance.** Done 2026-09-26: a review counts only once it calls
        the model (the pipeline stamps `token_usage.model_called_at` first), or
        while it is in progress. A copied review makes no call, so it won't
        count. It can record its source in its `intake_health` JSON, with no
        migration.
      - **Open questions.**
        - Should a copy share decisions already made on the old review?
        - How long does a prior review stay reusable?
        - Can associates reuse each other's reviews? That's a data-sharing
          question for CD.

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
