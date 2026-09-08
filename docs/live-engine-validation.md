# Stage 0 — validating the tracked-changes engine that ships today

**Date:** 2026-09-07 · **Branch:** `spike/tracked-changes-validation`

`lib/tracked-changes-docx.ts` is reachable in the running app: any DOCX-sourced
analysis offers a tracked-changes export, and the file it produces is emailed to
a hotel. It had never been tested against anything but clean, hand-made
documents. This is what testing it properly found.

**Three real defects, all now fixed.** The most serious produced files Word
cannot open, at a 16% rate on realistic redlines.

---

## What was found

### 1. Splicing across structural boundaries produced unopenable files

**Severity: critical. Found by randomised testing, not by the fixtures.**

The engine replaces everything between the first and last run overlapping a
matched phrase. When the phrase reached out of its container, the splice
swallowed that container's tags:

- across `</w:ins>` — the counterparty's own tracked change
- across `</w:sdtContent>` — a content control
- across `</w:tc>` — a table cell

The first two emit XML that does not parse (`Opening and ending tag mismatch:
"w:p" != "w:ins"`), which is a file Word refuses to open. The third silently
merged two cells, leaving a row with fewer cells than the table grid declares.

**Measured rate: 19 of 120 realistic redlines (16%).** The failures concentrate
on documents that already contain the counterparty's tracked changes — that is,
**every negotiation round after the first**, which is exactly when the tool is
most useful.

Fifteen hand-built fixtures did not catch this. A randomised generator did,
within 250 documents.

**Fix:** refuse any span crossing `w:p`, `w:tc`, `w:tr`, `w:tbl`, `w:ins`,
`w:del`, `w:moveFrom`, `w:moveTo`, `w:sdt`, `w:sdtContent`, `w:hyperlink` or a
field. The finding is reported as unapplied and listed for the associate rather
than silently mangling the document.

This is the conservative half of the trade: some legitimate edits are now
refused. Handling them properly — above all nesting a deletion inside the
counterparty's insertion — is §1.5.7 and belongs to the rewrite.

### 2. The appendix heading survived a reject-all

**Severity: serious. Found by fixture 06.**

Findings that could not be located are appended under a heading. The items were
wrapped in `w:ins`; the **heading was not**. So when the hotel rejected every
change, this stayed in their contract permanently, with no way to remove it by
rejecting:

> COULD NOT BE LOCATED FOR MARKUP (present in the contract — see the app for
> exact wording)

Internal tooling language, in a contract, sent to a counterparty.

**Fix:** the heading is now an insertion like the items beneath it.

### 3. Inserted paragraphs left empty paragraphs behind on reject

**Severity: minor. Found while fixing 2.**

`buildInsertedParagraph` wrapped its runs in `w:ins` but did not mark the
paragraph mark itself (§1.5.8). Rejecting removed the text and left a blank
paragraph. **Fix:** the paragraph mark now carries `w:ins` in `pPr/rPr`.

---

## What held up

Worth recording, because it is the reason the engine stays switched on until
§1.5 replaces it:

- **It finds phrases Word split across runs mid-word.** Its plain-text
  projection (`buildRunIndex`) handles the case that defeated docXMLater
  entirely (see [library-evaluation.md](library-evaluation.md)).
- Revision ids stay unique and within int32, including against a fixture with
  ids near the 2³¹ ceiling.
- Headers, footers, footnotes, comments, hyperlinks and bookmarks all survive.
- Rejecting only our author's revisions returns exactly the document the hotel
  sent, on all fifteen fixtures.

## Still limited (by design, deferred to §1.5)

- **Header and footer text cannot be marked up** — the engine only touches
  `word/document.xml`. Terms there are analysed but never redlined, and nothing
  says so.
- **First match wins.** Fixture 11 passes only because the quote is long enough
  to be unique. A short repeated quote can still redline the wrong clause;
  §1.5.1 requires disambiguating by section proximity.
- **Content-control and field text is refused, not handled.**
- **No comments carry rationale** — §1.5.11.

---

## Method, and two corrections to it

Fifteen fixtures plus a seeded randomised generator
(`scripts/fuzz-tracked-changes.ts`) that assembles documents from random
combinations of nested tables, merged cells, existing revisions from several
authors, mid-word run splits, tabs, bookmarks, hyperlinks, fields and content
controls — then picks its target the way the model does: a random span of a
paragraph's *visible* text.

Every document is checked for: XML that parses; unchanged table, row and cell
counts; unique in-range revision ids; `w:del` holding only `delText`; no dropped
parts; and the oracle — rejecting only our author's revisions returns the input
exactly.

**Two harness bugs produced false results before any of this was trustworthy,
and both are worth recording:**

1. An earlier draft reported **31 fatal errors that did not exist**. It counted
   tag balance with regex, and `<w:p[^>]*/>` also matches `<w:pStyle .../>`.
   Replaced with real XML parsing.
2. The reject oracle initially rejected *every* revision, not just ours, which
   also unwinds the counterparty's and winds the document back past what they
   sent. This is the same correction §1.6.2 needs and it had already been
   documented once — then reintroduced here.

The first randomised run also looked clean at 10/10 while 9 of those 10 applied
no redline at all: the quote picker was spanning paragraph boundaries, so it was
only exercising the refusal path. Fixed before the results meant anything.

## Result

- 15 fixtures: **0 fatal, 0 serious**
- 1000 randomised documents: **all pass**, 611 applying a real redline
- 15 previously-failing seeds pinned as regression tests in
  `tests/fuzz-regression.test.ts`
