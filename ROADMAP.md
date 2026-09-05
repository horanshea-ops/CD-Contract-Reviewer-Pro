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

- **Custom PDF viewer with in-place clause highlighting.** The review screen currently
  shows the contract via the browser's native PDF display (a plain `<iframe>`) — we
  don't control what's rendered inside it. That's fine for reading, but it means we
  can only ever jump to a *page* when a finding is clicked (a URL fragment the native
  viewer honors), not actually highlight the specific clause on top of the document,
  which is what the build brief's interface direction originally envisioned ("clicking
  one scrolls and highlights the relevant clause"). Doing real highlighting means
  replacing the iframe with a custom-built viewer — rendering PDF pages to canvas
  ourselves (via `pdfjs-dist`, which `unpdf` already wraps) and drawing a highlight
  overlay positioned from the same finding-location data the redline exports already
  compute. This is a genuinely separate, sizable UI project (a real PDF reader
  component, not a small addition) — not something to fold into the page-jump work.
  Revisit once there's a sense of how much associates actually want this versus
  page-level jumping being good enough. Page-level jumping itself (below) is done.

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
