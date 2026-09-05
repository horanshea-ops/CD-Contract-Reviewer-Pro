# Marked-up PDF + tracked-changes DOCX export

## Context

The requested-revisions memo (plain PDF listing findings) is done and working. The user
wants the two harder export formats next, matching a competitor: a **marked-up PDF**
(strikethrough + margin notes on the actual document) and **tracked-changes DOCX**
(real Word revision marks). The build brief explicitly flagged both as hard, out-of-v1
scope (§9) for the same reason: there's no reliable off-the-shelf way to do either in
pure JS — no positional PDF annotation library and no library that injects real
`w:ins`/`w:del` OOXML into an existing DOCX. This plan scopes both honestly, in phases
ordered by risk, so the first result ships fast and the harder problem is tackled with
its risk isolated rather than blocking everything.

## The constraint that shapes everything: tracked-changes DOCX can only ever work for DOCX-sourced uploads

Word's real tracked-changes are a DOCX/OOXML feature (`<w:ins>`/`<w:del>` inside
`word/document.xml`). To produce one, we need an actual DOCX to inject revisions into.
That only exists for analyses where `source_format = 'docx'` — we keep the original file
in storage (`original_storage_path`) for exactly this reason.

- **PDF-sourced uploads**: there is no Word document at all. Fabricating one from a PDF
  (real layout reconstruction) is a much harder, lower-fidelity problem — out of scope here.
- **Legacy DOC-sourced uploads**: `.doc` is a binary format (not XML); manipulating it
  programmatically in pure JS isn't practical without something like Apache POI (Java).
- **DOCX-sourced uploads**: works cleanly — this is the only case tracked-changes export
  will support.

**Marked-up PDF**, by contrast, can work for every source format, because we always have
*a* PDF (either the real upload, or the one we generate from DOCX/DOC text). So:

| Source format | Marked-up PDF | Tracked-changes DOCX |
|---|---|---|
| pdf | yes (Phase B) | no — not possible |
| docx | yes (Phase A) | yes (Phase C) |
| doc | yes (Phase A) | no — not possible |

This isn't a preference call, it's what the format actually allows.

## The key insight that reorders the work: we already control the DOCX/DOC-generated PDF

The hard part of "marked-up PDF" is normally: find *where on the page* a piece of quoted
text sits, so a strikethrough can be drawn over it. That needs real PDF text-extraction
with position data, then fuzzy-matching Claude's `quoted_text` against however the PDF's
internal text runs happen to be split up (ligatures, columns, hyphenation) — genuinely
the 20-30 hour problem the build brief warned about.

But for DOCX/DOC uploads, **we generate that PDF ourselves**, in
[`lib/text-to-pdf.ts`](../lib/text-to-pdf.ts) — a simple loop that already computes the
exact x/y and text of every line it draws. If that loop also records what it drew and
where, we get exact positions for free, with zero fuzzy matching, because there's no
mismatch to resolve — the same code that renders the line also reports its coordinates.

This means "marked-up PDF" splits cleanly into a fast, low-risk phase (A) and a slower,
genuinely uncertain one (B) — worth shipping and using separately rather than as one
undifferentiated feature.

## Phased plan

### Phase A — Marked-up PDF for DOCX/DOC-sourced analyses (low risk) — DONE

1. `textToPdf()` in [`lib/text-to-pdf.ts`](../lib/text-to-pdf.ts) also returns a position
   map: for each line it draws, `{ text, pageIndex, x, y, width, height }`.
2. The upload route ([`app/api/analyses/route.ts`](../app/api/analyses/route.ts)) stores
   that position data as a `line-positions.json` sidecar file in Storage alongside the
   generated PDF (not a DB column — kept this simple rather than inventing per-finding
   storage for data that's only needed at export time).
3. [`lib/redline-pdf.ts`](../lib/redline-pdf.ts): given the stored PDF + position data +
   accepted/edited findings, exact-substring-matches each finding's `quoted_text` against
   the recorded lines (normalizing whitespace), draws a strikethrough across every
   matched line plus a small numbered marker (`[1]`, `[2]`, ...) in the left page margin
   colored by severity, and appends a "Redline Notes" page listing full requested
   language + rationale per number. Missing-clause findings (nothing to strike through)
   are collected under a "REQUESTED ADDITIONS" heading instead of guessing a location.
4. `GET /api/analyses/[id]/export-markup` — same auth/ownership/status-complete pattern
   as the existing memo export, gated to `source_format !== 'pdf'`, audit-logged.
   The findings-fetch logic (accept/edit filter, severity sort) was factored out of the
   memo export route into [`lib/get-actioned-findings.ts`](../lib/get-actioned-findings.ts)
   so both export routes share it instead of duplicating the query.
5. Review screen: a second export button, shown only when `source_format !== 'pdf'`.

No new dependencies. No schema migration.

**Verified**: generated a real DOCX test contract, ran it through analysis, accepted a
mix of present and missing-clause findings, exported, and confirmed on inspection that
multi-line strikethrough spans land on the exact correct lines, margin markers are
positioned correctly, and the appendix correctly separates struck clauses from
requested additions.

### Phase B — Marked-up PDF for genuinely PDF-sourced analyses — DONE (for standard layouts)

1. [`lib/extract-pdf-lines.ts`](../lib/extract-pdf-lines.ts) uses `unpdf`'s
   `extractTextItems()` to pull positioned text from an arbitrary uploaded PDF.
   Turned out simpler than planned: `unpdf` already returns bottom-left-origin
   coordinates matching `pdf-lib`'s own coordinate system, plus font size and an
   end-of-line flag, so no manual transform math was needed. Items are word/run-level
   rather than full lines, which is finer-grained than the DOCX/DOC path — a
   strikethrough lands on exactly the matched substring, not the whole line.
2. Matching turned out **not** to need fuzzy logic — [`lib/redline-pdf.ts`](../lib/redline-pdf.ts)'s
   existing exact-substring matcher (built for Phase A) works unchanged, because
   `extractPdfLines()` returns the same `RenderedLine[]` shape Phase A already
   produces. One real bug found and fixed during testing: `unpdf` detaches/consumes
   the buffer it's given, which was silently corrupting `pdf-lib`'s copy of the same
   bytes — fixed by giving each library its own copy (`pdfBytes.slice()`).
3. The export route ([`app/api/analyses/[id]/export-markup/route.ts`](../app/api/analyses/[id]/export-markup/route.ts))
   now branches on `source_format` to get positioned lines either way, then calls the
   same `generateMarkupPdf()` regardless. The "PDF not supported yet" 400 is gone; the
   review screen's button is unconditional now.

**Verified**: ran this against the real, PDF-native synthetic sample contract (not one
generated by this app) — correct multi-line strikethrough, correct margin marker,
correct appendix — on the first attempt after fixing the buffer bug.

**What's genuinely still unvalidated**: this was tested against a clean, single-column
layout, which is likely representative of most contract body text but is not the hard
case. Multi-column layouts, tables, and scanned/image-based pages — where a PDF's
internal content-stream order can depart from visual reading order — remain untested
against real samples. The existing not-found fallback (skip the strikethrough, list the
item in the appendix instead of guessing) is the safety net for exactly this case, and
it's shared, already-exercised code from Phase A, but real-world stress-testing is still
open. Revisit once real (or more adversarial synthetic) contract PDFs are available.

### Phase C — Tracked-changes DOCX (DOCX-sourced only) — NOT STARTED

1. Add `jszip` (read/write the DOCX's zip container) — deliberately **not** a generic
   XML-tree parse/rebuild library for `word/document.xml`. Word's XML is sensitive to
   exact attribute order and namespace formatting; round-tripping the whole tree through
   a generic parser risks producing a file Word can't open, or that silently loses
   formatting. Instead: treat `document.xml` as a string and do targeted, surgical
   splicing — locate the run(s) containing each finding's `quoted_text` via a narrow
   regex over `<w:r>...<w:t>...</w:t>...</w:r>` sequences, and wrap only that span in
   `<w:del><w:r><w:delText>...</w:delText></w:r></w:del>` followed by
   `<w:ins><w:r><w:t>...</w:t></w:r></w:ins>` — everything else in the file stays
   byte-for-byte untouched.
2. DOCX splits text across `<w:r>` runs unpredictably (formatting/spell-check
   boundaries), which is a different flavor of the same underlying problem Phase B
   solved for PDF text items — worth checking whether the same exact-match approach
   holds up here too before assuming fuzzy matching is actually needed.
3. Missing-clause findings: same approach as Phase A — appended as a new, clearly
   labeled "Requested Additions" section wrapped in `<w:ins>`, not inserted in-place.
4. `GET /api/analyses/[id]/export-redline-docx` — same pattern again, gated to
   `source_format === 'docx'` (400 otherwise), audit-logged.
5. Review screen: a third button, visible only when `source_format === 'docx'`.
6. **Verification limit to flag honestly**: this environment can confirm the output is
   a structurally valid docx (re-opens cleanly, e.g. round-tripped through `mammoth`),
   but can't confirm Word's actual Reviewing pane renders it correctly — there's no
   Word here. The real check is opening a generated sample in real Word, or uploading
   it to Google Docs (which also honors `w:ins`/`w:del` as suggestions on import).

## Recommended sequencing

Phase A shipped first — fast, low-risk, immediately useful for every DOCX/DOC upload.
Phase B shipped next and validated cleanly against a standard single-column layout,
faster than expected since the exact-match approach from Phase A turned out to extend
directly rather than needing new fuzzy-matching logic. Phase C is next, and should
start by checking whether that same exact-match approach holds up for DOCX's run
structure before assuming it needs its own matching logic.

## Explicitly out of scope

- Tracked-changes for PDF- or DOC-sourced analyses (not possible, see constraint above).
- Any LibreOffice/headless-browser dependency (rejected earlier for DOCX upload, same
  reasoning applies here: heavy, awkward on Vercel).
- A generic PDF→DOCX layout reconstruction (would be its own large, low-fidelity effort).
