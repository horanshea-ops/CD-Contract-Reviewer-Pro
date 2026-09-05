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
- [~] 4b. Marked-up PDF / tracked-changes DOCX (added to scope, competitor parity) —
      Phase A (marked-up PDF, DOCX/DOC-sourced) done; Phases B (PDF-sourced) and C
      (tracked-changes DOCX) not started. See open items below for detail.
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

**Roadmap, not v1:** 16-18 deferred by design, see open items below — except item 18
(tracked-changes DOCX), whose priority just changed; see below.

## Open items

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
  - [ ] **Phase B — marked-up PDF for genuinely PDF-sourced analyses.** Not started.
    The real hard part — needs `unpdf`/`pdfjs-dist` text-extraction plus fuzzy
    matching against arbitrary real-world PDF layouts. No solid time estimate
    up front; needs iteration against real sample documents.
  - [ ] **Phase C — tracked-changes DOCX.** Not started. DOCX-sourced only — there's
    no Word document to inject revisions into for PDF- or DOC-sourced analyses.
    Needs `jszip` + surgical string-splicing of `word/document.xml` (deliberately
    not a generic XML-tree rebuild, to avoid corrupting a file Word can't open).
    True verification needs a human opening a sample in real Word/Google Docs —
    not something this environment can confirm on its own.

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
  stage-2/3 library.

- **Named senior associates for library validation and the answer key**
  (build brief §15 item 3) — the resource ask that gates stage 2/3 of the library
  and the real accuracy gate.

- **CD security environment integration** (build brief §4.2, §15 item 4) — SSO/IdP,
  hosting requirements, review process. Deferred by design; not needed for the pilot.

- **Who owns this after handoff** (build brief §15 item 5) — named maintainer,
  time allocated.

- **Platform benefit vs. sold product** (build brief §15 item 6) — CD's call with
  counsel/insurance; affects "not legal advice" framing if it changes.
