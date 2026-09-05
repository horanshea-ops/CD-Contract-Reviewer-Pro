# Roadmap / open items

Tracks decisions and follow-ups that are noted but deliberately not acted on yet,
per the build brief's phasing. See the build brief §11 for the authoritative build
order — the checklist below just tracks progress against it.

## Build order progress (build brief §11)

**Now, on personal accounts, no CD data:**

- [x] 1. Analysis pipeline, headless — stage-1 library, structured outputs, inline PDF
- [ ] 2. Eval harness against a synthetic answer key — **deferred at request**, revisit
      once the library/UI are further along
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

- **Standards library breadth vs. depth.** The library now covers 19 clause types:
  the 11 named in the build brief §1, plus 8 more drafted from general industry
  practice (insurance & indemnification, damage/security deposit, exclusivity/outside
  vendor restrictions, termination for convenience vs. cause, assignment/subcontracting,
  brand/ownership change, named-storm/hurricane language, attendee data handling).
  Every entry is `provenance: industry_default` — generic best practice, not CD's
  actual negotiated position. Breadth (which categories exist) is done for v1;
  depth (is each entry actually right, and what does CD concede first / where does
  it walk) still requires a senior associate and cannot be shortcut. Revisit
  alongside library validation (build brief §10.2, §15 item 3) — that is the gate,
  not more categories.

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
