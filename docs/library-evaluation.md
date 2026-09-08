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

---

# Round 2 — five harder fixtures

The first round used four hand-built fixtures, which is thin evidence for a
decision that sets the schedule for the rest of Part 1. Round 2 added five
fixtures covering what real contracts actually contain: Word's move tracking,
multi-level numbering with a cross-reference field, content controls and field
codes, tracked changes inside table cells, and the run splitting Word itself
emits.

**The decision is unchanged and now much better supported.** Two of the five
reproduced the attribution bug independently, and two entirely new failures
appeared — one of which is worse than anything found in round 1.

## Results

| Fixture | Case | Outcome |
|---|---|---|
| 05 move | edit outside the move (control) | ✅ tracked correctly |
| 05 move | edit the moved clause | ❌ **untracked, no revision** |
| 07 numbering | edit a numbered list item | ✅ tracked; numbering and fields preserved |
| 08 content controls | edit inside a content control | ⚠️ `count: 0` — cannot see the text |
| 09 tables | edit inside a tracked change in a cell | ❌ **untracked, no revision** |
| 10 run splitting | phrase split across runs | ❌ **`count: 0` — cannot find the text** |

Structurally, nothing was destroyed: numbering, content controls, field codes,
tables and move revisions all survived every round trip, and no part was
dropped.

## New finding 1 — it cannot match text spanning run boundaries

**This is the most consequential result of the evaluation.**

Fixture 10 reads, to a human and to the model:

> Client shall be liable for eighty percent (80%) of the group rate for each
> unsold room night.

Underneath, Word has split that across four runs mid-word, with a `proofErr`
between them — exactly what Word emits after ordinary editing and spell-check:

```xml
<w:r w:rsidR="00A12B34"><w:t>Client shall be liable for eighty per</w:t></w:r>
<w:proofErr w:type="spellStart"/>
<w:r w:rsidR="00A12B34"><w:t>cent</w:t></w:r>
<w:proofErr w:type="spellEnd"/>
<w:r w:rsidR="00B57C11"><w:t> (80</w:t></w:r>
<w:r w:rsidR="00B57C11"><w:t>%) of the group rate</w:t></w:r>
```

Measured behaviour:

```
findAndReplaceAll("eighty percent (80%)")  ->  count = 0   (not found)
findAndReplaceAll("thirty (30) days")      ->  count = 0   (not found)
findAndReplaceAll("eighty per")            ->  count = 1   (fits in one run)
findAndReplaceAll("of the group rate")     ->  count = 1   (fits in one run)
```

It matches only within a single run. The analysis pipeline returns
`quoted_text` copied verbatim from the document's *visible* text, so those
quotes will routinely straddle run boundaries — and would silently fail to
apply.

**The existing `lib/tracked-changes-docx.ts` already handles this correctly**,
by building a plain-text projection across runs and mapping matches back to
run offsets (`buildRunIndex`). On the single most common real-world case, the
library is a regression against what the repository already has.

## New finding 2 — the attribution bug is not limited to `w:ins`

Round 1 found that editing text inside the counterparty's insertion rewrites it
in place under their name. Round 2 shows the same failure in two further shapes:

- **Inside a `moveFrom`/`moveTo` pair** (fixture 05): `count: 2`, our revision
  elements: 0. It edited both copies of the moved clause, untracked.
- **Inside a tracked change in a table cell** (fixture 09): `count: 2`, our
  revision elements: 0. It silently changed a cancellation damages figure from
  "seventy-five percent (75%)" to "sixty percent (60%)" with no redline.

Fixture 09 is the worst case found. The cancellation schedule carries the
largest dollar exposure in a hotel contract, and this alters a damages
percentage invisibly, in a table, with no mark for the counterparty to see.

Across both rounds the bug reproduced in **five independent scenarios**, with
two authors, three document structures and replacement text unrelated to
anything deleted. Control edits outside existing revisions worked correctly
every time, which is what makes it dangerous: it works until it doesn't, and it
never says so.

## New finding 3 — content-control text is invisible

Fixture 08 returned `count: 0` for a span inside a `w:sdt`. That happens to
satisfy §1.5.3's "refuse to edit inside a content control", but for the wrong
reason — it cannot see the text rather than deliberately declining. The
practical effect matches the header/footer limitation: terms stored there can be
analysed but never marked up, and nothing reports that they were skipped.

## Harness caveat

Fixture 10's oracle line also reported a failure, but that one was an artifact
of the harness's own accepted-text extraction mishandling `proofErr` elements
between runs, not a library defect. The real finding for fixture 10 is the
`count: 0` above. Noted because two earlier apparent failures — dropped bold
formatting, and the unscoped reject-all — were likewise harness bugs, and a
decision this size should be explicit about which measurements were wrong.

## Conclusion

Ten fixtures, sixteen scenarios. The library preserves documents well and edits
plain body text correctly, but it cannot find the text the model will actually
quote, and when the target sits inside any existing revision it edits under
someone else's name without saying so. Both are silent failures in a document
that gets emailed to a counterparty.

**Confirmed: hand-roll per §1.3.3.** All ten fixtures stay as §1.11 corpus.
