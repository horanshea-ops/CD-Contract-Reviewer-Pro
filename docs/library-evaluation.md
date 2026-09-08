# §1.3 Library evaluation — decision

**Date:** 2026-09-07 · **Branch:** `spike/library-eval` · **Model:** Opus 5, high effort

**Decision: do not adopt a third-party redlining library. Hand-roll the revision
engine per MASTER_PLAN.md §1.3.3.**

---

## Candidates

| Candidate | Outcome |
|---|---|
| `docx-redline-js` | **Does not exist.** No such package on npm (404). |
| `docXMLater` (`docxmlater`) | Real, actively developed, evaluated in full below. **Rejected.** |

## docXMLater — project health

| Signal | Value |
|---|---|
| Version | 12.1.0 |
| Published versions | **349 in ~11 months**, 12 major bumps |
| Weekly downloads | 76–533 |
| Stars / forks / watchers | 15 / 5 / 0 |
| Open issues | 0 |
| Tests + CI | Present |
| Maintainers | 1, personal email |
| Only runtime dependency | `jszip` — which this project already uses |

Roughly a release per day and twelve majors in a year is a serious instability
signal, but it did not decide this on its own. §1.3.4 would have pinned the
version regardless.

## What it does well

Round-tripped against four synthetic fixtures with `revisionHandling: 'preserve'`:

- Existing `w:ins`/`w:del` preserved, with author attribution intact
- Tables and rows preserved (2 tables, 11 rows)
- Bold and italic preserved
- Visible text unchanged
- Headers and footers preserved as parts
- Editing text **outside** any existing revision produces correct, well-formed
  tracked changes, and the §1.6.2 oracle holds

## Why it was rejected

### 1. Editing inside an existing insertion silently forges attribution

**This is disqualifying on its own.** When the text to be changed lies inside an
existing `w:ins` — i.e. language the counterparty inserted — `findAndReplaceAll`
with `trackChanges: true` rewrites the text *in place, inside their revision,
under their name*, and creates no revision of our own.

Before (counterparty replaced "cumulative" with "night-by-night"):

```xml
<w:del w:author="Dana Reyes"><w:delText>cumulative</w:delText></w:del>
<w:ins w:author="Dana Reyes"><w:t>night-by-night</w:t></w:ins>
```

After asking it to change "night-by-night" to "quarterly aggregate" as
*Jane Associate*:

```xml
<w:del w:author="Dana Reyes"><w:delText>cumulative</w:delText></w:del>
<w:ins w:author="Dana Reyes"><w:t>quarterly aggregate</w:t></w:ins>
```

It reports `count: 1` and `revisions: 0`. No error, no warning.

The consequences, in order of severity:

1. **The document falsely asserts the counterparty wrote our language.**
   Fabricated provenance in a negotiation document.
2. **Our redline is invisible.** The hotel opens the file and sees no change from
   us on that clause.
3. **It cannot be accepted or rejected**, because it is not marked as a change.
4. **It fails silently**, so an associate would send it believing it worked.

Reproduced on two fixtures, two different authors, with replacement text
unrelated to anything deleted — so this is not "revert detection". A control
edit in the same document, outside any revision, worked correctly.

**This is not an edge case.** From round two of any negotiation onward, the
counterparty's insertions are exactly the clauses we most want to push back on.
§1.9's multi-round work makes this the common path, not a rare one.

### 2. Header and footer content is unreachable by the edit API

`findAndReplaceAll` returns `count: 0` for text that exists only in a header,
even though the header part itself survives the round trip. Hotels routinely put
cutoff dates and cancellation-notice terms there (§1.4.1), so those terms could
be analysed but never marked up.

### 3. No control over diff granularity

It emits a minimal character-level diff. Replacing "eighty percent (80%)" with
"seventy percent (70%)" produces:

```xml
<w:del><w:delText>eighty percent (8</w:delText></w:del>
<w:ins><w:t>seventy percent (7</w:t></w:ins>
<w:r><w:t>0%) of the group rate…</w:t></w:r>
```

Structurally correct — accept and reject both resolve properly — but in Word's
reviewing pane the hotel sees `eighty percent (8` struck against
`seventy percent (7` with a stray `0%)`. §1.5.5 and §1.5.6 specify deleting and
inserting the whole phrase. No option to change this was found in the typings.

## Correction to the plan: §1.6.2's oracle needs an author scope

§1.6.2 says "rejecting all our changes must return exactly the document the hotel
sent." In a document that already contains the counterparty's revisions, a
blanket reject-all also rejects *theirs*, winding the document back past what
they sent and failing a check that should pass.

**The oracle must reject only revisions attributed to our author**, then compare
against the accepted view of the input. Implement it that way in §1.6.

## Consequence for §1.4 and §1.5

Take §1.3.3: build on `jszip` (already a dependency, already used by
`lib/tracked-changes-docx.ts`) plus `@xmldom/xmldom` and `xpath` for DOM-level
manipulation, which run splitting requires.

This also settles the comment at `lib/tracked-changes-docx.ts:4-16`, which argued
for regex string-splicing over a generic parse/rebuild. That reasoning was
directionally right about the risk but reached too far: the fix is a DOM approach
scoped to the nodes we touch, not a whole-tree rebuild and not regex splicing.
§1.5.7's nested case is precisely what neither of those handles.

The evaluation harnesses (`scripts/eval-library.ts`,
`scripts/eval-library-edits.ts`) and the `docxmlater` dependency were removed
after this decision; both remain in the history of `spike/library-eval` if the
question is ever reopened.

## What we keep

The five synthetic fixtures built for this evaluation are §1.11 fixtures 1, 2, 3,
4 and 6, and stay. They are byte-stable across regeneration
(`npm run fixtures:generate`) and their intent is asserted in
`tests/fixtures.test.ts`.
