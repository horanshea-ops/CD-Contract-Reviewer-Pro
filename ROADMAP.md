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
      *Open, for a follow-up*: a table quote that omits the extractor's `|` separators
      lands just under the 0.95 fuzzy threshold and is reported as not located
      (`13-nested-merged-tables.docx`). §1.4's live check showed the model does include
      them, so this is a narrow case — but tables are where the money is, and matching
      against a pipe-stripped projection would close it.

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

## Build order progress (build brief §11)

**Now, on personal accounts, no CD data:**

- [x] 1. Analysis pipeline, headless — stage-1 library, structured outputs, inline PDF
- [x] 2. Eval harness against a synthetic answer key — **built 2026-09-09** as §2.0.1.
      Seven generated contracts, 90 key items, scored by document position rather than
      by clause name. `npm run eval:capture` then `npm run eval:score -- --run <label>`.
      See `docs/eval-harness.md`, including how CD's real key swaps in.
- [x] 3. Scaffold — Next.js, Supabase schema, own auth layer, and GitHub repo
      ([horanshea-ops/CD-Contract-Reviewer-Pro](https://github.com/horanshea-ops/CD-Contract-Reviewer-Pro))
      all done; **Vercel deploy not started**, still local-only (`npm run dev`). Note
      for later: real deploys need Vercel Pro ($20/mo) — Hobby's 60s function limit
      is under our 300s analysis budget.
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

      Fix is in `buildSystemPrompt` and `FINDINGS_TOOL_SCHEMA`'s description in
      `lib/anthropic.ts`: a finding means a deviation, a compliant clause belongs in
      `clauses_checked` and nowhere else. **Opus work** — changing the analysis system
      prompt changes the output of every review. Re-run `npm run eval:capture` and
      compare precision to tell whether it worked; that is what the harness is for.

      It is also most of the bill. Capture cost is dominated by output (79k output
      against 76k input), so this cuts cost as well as noise.

- [ ] **2. Severity is over-called.** Half the calls are exact and 95% land within one
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

- [ ] **4. Downstream consumers assume every finding is actionable.** Even once the
      prompt is fixed, nothing between the model and the redline/memo/email checks
      that a finding proposes an actual change. A defensive filter is cheap insurance
      against a regression reaching a hotel. Decide whether to add one, or to rely on
      the eval catching it.

- **Watching: the harness itself is thin.** Seven contracts and 90 key items support
  the per-clause and per-severity breakdowns, but not reading any single percentage as
  a forecast. Eight more specs are written and held in `RESERVE_SPECS` — widening the
  corpus is moving an id into the active list and re-running the build. Exposure is
  graded on 15 of 87 pairs and proposed language on 57, both by design (see
  `docs/eval-harness.md` § Known limits). None of this blocks acting on items 1-4.


- **Export and email button consolidation — §1.12, not started (raised by the user
  2026-09-09).** The analysis header now carries six controls: Export memo, Draft
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

- **Work that does not need CD — now §2.0.1/§2.0.2/§2.0.3/§2.1.1 (noted 2026-09-09,
  not started).** Numbered into `MASTER_PLAN.md` on 2026-09-09 and marked ungated there;
  90-140 hours in total. In leverage order:
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
  2. **Term extraction — §2.0.2, Opus 5 · xhigh.** Its own answer key was described as
     needing a senior
     associate, but verifying that a contract saying 90% was extracted as `0.90` is
     reading comprehension, not negotiating expertise — anyone literate can check
     it, and the 15 synthetic fixtures have known ground truth by construction.
     §2.0.2 is infrastructure whose correctness is independently checkable, so
     building it does not compound the damage the gate exists to prevent. The four
     dependent features (deadlines, what-if, savings, exec summaries) stay gated.
     **This was a deviation from "nothing in Part 2 starts until the gate clears";
     the user accepted it on 2026-09-09 and `MASTER_PLAN.md` now states it directly.**
  3. **Diff mechanics — §2.1.1, Opus 5 · xhigh.** Diffing what we sent against what came
     back is document work. The reconciliation into `finding_outcomes` is now §2.1.2 and
     stays gated, because "the property rejected this finding" only means something once
     the finding is known to be right.
  4. **Vercel deploy** — still local-only, needed regardless. Note Pro ($20/mo);
     Hobby's 60s function limit is under the 300s analysis budget.
  5. **The §1.5 table-quote follow-up** below — narrow, but tables carry the money.

- **Portability: retooling for a different client — now §2.0.3 (noted 2026-09-09,
  nothing acted on).** Raised by the user — if CD does not buy, how cheaply can this serve another
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
