# CD Contract Reviewer — Master Plan

Pipeline implementation, feature roadmap, and handoff.
Companion to `BUILD_BRIEF.md`, whose non-negotiables govern everything here.

**How to use this document**

- **Part 1** is buildable now and is the current work package.
- **Part 2** is sequenced but gated — nothing in it starts until the accuracy gate clears
  (stage-3 standards library plus real answer key, `BUILD_BRIEF.md` §10.3).
- **Parts 3 and 4** happen at sale and transfer.

Total scope here is multi-year. It is a menu with an argued order, not a commitment.

---

## 0. Constraints carried forward

1. **Negotiating aid, not legal advice.** Nothing generated — markup, comments, emails,
   summaries, savings figures — may characterise legal effect, offer assurance, or read as
   a legal opinion.
2. **No autonomous sending.** Every artifact is a draft a person reviews and sends.
3. **API key server-side only.** All model calls route through one backend module.
4. **Never modify the stored original.** All work happens on copies; the file as received
   is immutable and is what validation compares against.
5. **Only accepted findings propagate.** Dismissed findings must not appear in exports,
   emails or summaries. Assert this in tests.
6. **The model narrates; it does not compute.** Every number in any client-facing artifact
   comes from the calculation engine, never from model output. This becomes critical in
   Part 2.

---

## 0.1 Model and effort assignments

This project is built with Claude Code. Model choice matters unevenly: most of this work
is ordinary web development where Sonnet 5 is more than sufficient, and a minority is
work where a subtle error is silent, expensive and hard for a non-specialist to detect.
Spend capability there.

### Standing rules

1. **Sonnet 5 at high effort is the default.** It defaults to high in Claude Code; leave
   it there.
2. **Opus 5 for anything where a wrong answer is silent.** Document structure
   manipulation, financial arithmetic, security boundaries, validation logic.
3. **Xhigh effort for the hardest modules.** Xhigh is the documented level for the hardest
   coding and agentic tasks. The extra tokens are trivial against a week lost to a
   corrupt-file bug.
4. **Override the table upward, never downward,** for anything touching authentication,
   row-level security, key handling, tenant isolation, or money math — regardless of which
   section it appears in.
5. **Escalation of last resort:** if a module fails repeatedly at Opus 5 xhigh and the
   cause isn't visible, Fable 5.1 is the documented next step for demanding long-horizon
   agentic work. It costs roughly double Opus 5, so use it to break a specific blockage,
   not as a default.
6. **Always use plan mode before starting a section.** Review the plan before any code is
   written.

### Assignment table

| § | Work | Model | Effort | Why |
|---|---|---|---|---|
| 1.3 | Library evaluation | Opus 5 | high | Judgment call that determines the whole schedule |
| 1.4 | Extraction + source map | **Opus 5** | **xhigh** | Off-by-one errors here corrupt documents silently and propagate everywhere |
| 1.5 | Revision insertion | **Opus 5** | **xhigh** | Hardest module in the project; failures are structural and invisible |
| 1.6 | Validation layer | **Opus 5** | high | This is the oracle. If it's wrong you trust broken output |
| 1.7 | PDF fallback + worker | Sonnet 5 | high | Plumbing and a container |
| 1.8 | Email drafting | Sonnet 5 | high | Ordinary feature work |
| 1.8.3 | Property-email field allowlist | Opus 5 | high | Leakage here hands leverage to the counterparty |
| 1.9 | Round-thread hooks | Sonnet 5 | high | Schema and CRUD |
| 1.10 | AI-use pre-check | Sonnet 5 | high | Regex and a gate |
| 1.11 | Test fixture generation | Sonnet 5 | high | Content creation |
| 1.11 | Assertion suite design | Opus 5 | high | The tests are what let you iterate blind |
| 1.12 | Export picker UI | Sonnet 5 | high | UI over routes that already exist |
| 1.12 | Email audience selector | **Opus 5** | high | Sending the client draft to the property is unrecoverable, and nothing downstream catches it |
| — | Auth, RLS, key handling | **Opus 5** | high | Silent failure, serious consequence |
| 2.0 | Term extraction layer | **Opus 5** | **xhigh** | Every downstream number depends on it |
| 2.1 | Multi-round diff engine | **Opus 5** | **xhigh** | Reconciliation logic is subtle and wrong answers look plausible |
| 2.2 | Deadline extraction | Sonnet 5 | high | Straightforward once 2.0 exists |
| 2.3 | Value calculators + bucket model | **Opus 5** | **xhigh** | Money math that leaves the building |
| 2.3 | Savings UI | Sonnet 5 | high | Presentation |
| 2.4 | Summary generation architecture | Opus 5 | high | The engine/model determinism boundary must hold |
| 2.4 | Summary templates and UI | Sonnet 5 | high | Presentation |
| 2.5 | Pre-signature verification | Sonnet 5 | high | Reuses 2.1 |
| 2.6 | Learn tab | Sonnet 5 | high | Content and presentation |
| 2.7 | Property history | Sonnet 5 | high | Queries and display |
| 2.8 | Benchmarking statistics | Opus 5 | high | Statistical claims shown to associates |
| 2.9 | Exposure rollup | Sonnet 5 | high | Aggregation |
| 2.10–2.12 | Smaller additions | Sonnet 5 | high | Ordinary |
| 3.1 | Security overview | Opus 5 | high | Reasoning document, externally reviewed |
| 3.2–3.6 | Runbook and other docs | Sonnet 5 | high | Writing |
| 4.x | Handoff execution | Sonnet 5 | high | Mostly not code |

### CLAUDE.md protocol

Add this to `CLAUDE.md` in the repository root so Claude Code enforces the assignments
rather than relying on memory:

```markdown
## Model and effort protocol

MASTER_PLAN.md §0.1 assigns a model and effort level to every work item.

At the start of every work item, before writing any code:
1. State which section of the plan you are working on.
2. State the model and effort level that section requires.
3. State which model you are currently running.
4. If they do not match, STOP. Tell me to switch, and wait. Do not proceed.

Never begin work on §1.4, §1.5, §1.6, §2.0.1, §2.0.2, §2.0.3, §2.1.1, §2.1.2 or §2.3 — or on anything touching
authentication, row-level security, key handling, or financial calculation — while
running Sonnet. Those require Opus 5.

If you have attempted the same failing test three times on a §1.4 or §1.5 task at
xhigh effort, stop and say so rather than trying a fourth approach. Repeated failure
there usually means the approach is wrong, not that the implementation needs another
pass.

Before starting any section, use plan mode and get the plan approved.

## Branch and commit protocol

Work happens on a branch named for the plan section (`phase/1-5-revision-engine`),
never directly on `main`. At the start of a work item, state which branch you are on.
If it is `main`, stop and create the correct branch first.

Commit at every working state, not at every finished feature. A working state is any
point where the test suite passes, however incomplete the feature is. Write commit
messages describing what changed, not what section you are on.

Never commit `.env`, any file containing a key, or any contract document. If you are
about to stage a file matching those, stop and tell me.

Before merging to `main`, confirm the section's tests pass and say which ones you ran.
```

This is a soft mechanism — the model cannot switch itself and may not always identify
itself correctly. It is cheap and mostly works. Check it yourself at the start of the
high-stakes sections.

---

## 0.2 Working practice: branches and worktrees

### Why this matters here specifically

The usual argument for branches is team collaboration, which does not apply to a solo
builder. Three other arguments do:

1. **AI-assisted development produces broken states.** When forty files change across an
   hour and the result does not work, you need to return to a known-good state in one
   command. Without commits, you cannot.
2. **§1.4 and §1.5 are the modules most likely to spiral.** On a branch, a bad week is
   thrown away with the branch. On `main`, it is entangled with everything else you did
   that week.
3. **Once the pilot starts, `main` is what associates are using.** You cannot experiment on
   the thing 450 people depend on for client contracts.

### Branch convention

One branch per plan section:

```
main                        always deployable
phase/1-4-extraction
phase/1-5-revision-engine
phase/1-6-validation
phase/1-8-email-drafting
fix/<short-description>
```

Merge to `main` when the section's tests pass. Tag at phase completion (`v0.2-extraction`)
so you can return to any milestone.

**Vercel creates a preview deployment for every branch automatically.** Each branch gets
its own URL. That is how you test the revision engine against real documents without
touching what associates are using — and it costs nothing extra on the Pro plan you are
already paying for.

### Commit discipline

Commit at every **working** state, not at every finished feature. With AI-assisted
development you want many small commits, because the value of a commit is that it is a
point you can return to. "It compiles and the extraction test passes" is a commit.

Before the pilot: merge freely, you are the only one affected.
After the pilot: turn on branch protection on `main` in GitHub, and require the build to
pass before merge. Once CD owns the repository this is not optional.

### Git worktrees

A worktree is a second working copy of the project on disk, on a different branch, sharing
one repository history. Instead of switching branches in place, you have two folders open
at once.

```bash
git worktree add ../cdcr-revision phase/1-5-revision-engine
git worktree add ../cdcr-email    phase/1-8-email-drafting
```

**The reason to use them on this project is parallel model use.** You cannot productively
run Opus 5 on the revision engine and Sonnet 5 on email drafting in the same Claude Code
session. Two worktrees means two sessions, two branches, two models — which maps directly
onto the assignment table in §0.1.

Sections that are safe to run in parallel with the §1.4/§1.5 critical path:

| Section | Model | Independent because |
|---|---|---|
| §1.8 Email drafting | Sonnet 5 | Reads findings; touches no document code |
| §1.9 Round-thread hooks | Sonnet 5 | Schema and CRUD only |
| §1.10 AI-use pre-check | Sonnet 5 | Runs before extraction; separate module |
| §1.11 Test fixtures | Sonnet 5 | Content, not code |

**Not parallel-safe:** §1.6 validation and §1.7 PDF path both depend on §1.4's output
shape. §1.5 depends on §1.4 and §1.6. Do those in sequence.

**Two cautions for a solo builder.** Worktrees add real overhead — two directories, and it
is easy to run a command in the wrong one. And both worktrees hit the **same Supabase
project** unless you create a second one, which produces confusing shared state during
schema work. Use worktrees only for genuinely independent workstreams, only once branches
feel routine, and create a separate Supabase branch or project if both streams touch the
schema.

### Never commit

- `.env`, `.env.local`, or any file containing a key. Add to `.gitignore` on day one and
  verify with `git status` before the first commit. A key committed once lives in history
  forever, even if deleted later — the only fix is rotation.
- Any CD client contract. Synthetic fixtures only, as §1.11 requires.
- Generated output files or `node_modules`.

---

# PART 1 — DOCX REVISION PIPELINE

Current work package. Read fully before writing code; the phases have hard dependencies.

## 1.1 Architecture

```
                      ┌─────────────────────────────────┐
  upload (.docx/.doc/.pdf)                              │
        │             │                                 │
        ▼             │                                 │
  ┌───────────────┐   │   PHASE 7 — no network egress   │
  │ AI-use scan   │◄──┘                                 │
  │ (local regex) │                                     │
  └───────┬───────┘                                     │
          │ hit → associate acknowledges or aborts      │
          ▼                                             │
  ┌───────────────────────────────────────┐             │
  │ PHASE 1  Extraction                   │             │
  │  · parse OOXML parts                  │             │
  │  · detect existing revisions          │             │
  │  · build accepted-view text           │             │
  │  · build source map (char → run)      │             │
  └───────┬───────────────────────────────┘             │
          ▼                                             │
  ┌───────────────────────────────────────┐             │
  │ analysis (existing pipeline)          │─────────────┘
  │  standards library → findings JSON    │
  └───────┬───────────────────────────────┘
          ▼
    associate reviews: accept / edit / dismiss
          │
          ├──────────────────────┬─────────────────────┐
          ▼                      ▼                     ▼
  ┌───────────────┐      ┌───────────────┐    ┌───────────────┐
  │ PHASE 2       │      │ PHASE 5       │    │ PHASE 6       │
  │ revision      │      │ email drafts  │    │ round thread  │
  │ insertion     │      │ client /      │    │ linkage       │
  └───────┬───────┘      │ property      │    └───────────────┘
          ▼              └───────────────┘
  ┌───────────────┐
  │ PHASE 3       │  pass → marked-up .docx
  │ validation    │  partial → .docx + unapplied list
  └───────┬───────┘  fail ↓
          ▼
  ┌───────────────┐
  │ PHASE 4       │  → marked-up .pdf
  │ PDF fallback  │
  └───────────────┘
```

**Key design rule:** extraction must be **pure and deterministic**. The same input always
produces the same text and the same source map, so the map is re-derived at export time
rather than persisted. Do not cache it — a stale map against a re-uploaded file is a
corruption bug that is very hard to diagnose.

## 1.2 Data model additions

```sql
ALTER TABLE analyses ADD COLUMN source_format text;         -- docx | doc | pdf
ALTER TABLE analyses ADD COLUMN had_existing_revisions boolean;
ALTER TABLE analyses ADD COLUMN existing_revision_authors jsonb;
ALTER TABLE analyses ADD COLUMN existing_revision_count int;
ALTER TABLE analyses ADD COLUMN ai_clause_scan_result jsonb;
ALTER TABLE analyses ADD COLUMN ai_clause_acknowledged_by uuid;
ALTER TABLE analyses ADD COLUMN ai_clause_acknowledged_at timestamptz;

ALTER TABLE findings ADD COLUMN span_resolution text;       -- exact | normalized | fuzzy | unresolved
ALTER TABLE findings ADD COLUMN applicability text;         -- applicable | blocked_table |
                                                            -- blocked_content_control | blocked_field |
                                                            -- blocked_cross_paragraph | blocked_already_deleted
ALTER TABLE findings ADD COLUMN applicability_detail text;

CREATE TABLE exports (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  associate_id uuid NOT NULL,
  format text NOT NULL,                -- docx | pdf | memo
  outcome text NOT NULL,               -- clean | partial | fallback
  fallback_reason text,
  findings_applied int,
  findings_unapplied int,
  unapplied_detail jsonb,
  storage_path text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE email_drafts (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  associate_id uuid NOT NULL,
  audience text NOT NULL,              -- client | property
  subject text,
  body text,
  edited_by_associate boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE negotiation_threads (
  id uuid PRIMARY KEY,
  client_id uuid,
  property_name text,
  event_start date,
  event_end date,
  associate_id uuid NOT NULL,
  status text,                         -- open | signed | dead
  created_at timestamptz DEFAULT now()
);

ALTER TABLE analyses ADD COLUMN thread_id uuid;
ALTER TABLE analyses ADD COLUMN round_number int DEFAULT 1;
ALTER TABLE analyses ADD COLUMN parent_analysis_id uuid;

CREATE TABLE finding_outcomes (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL,
  observed_in_analysis_id uuid NOT NULL,
  outcome text,                        -- accepted | partially_accepted | countered |
                                       -- rejected | unchanged | undetermined
  counter_language text,
  notes text,
  created_at timestamptz DEFAULT now()
);
```

`exports.outcome` and `fallback_reason` are the dataset that tells you which document
constructs break the engine. Instrument from day one.

## 1.3 Library selection — do this first

**Step 1.3.1.** Evaluate `docx-redline-js` and `docXMLater` against a real hotel contract
containing existing tracked changes. Both are young open-source projects; check commit
recency, issue quality, test coverage.

**Step 1.3.2.** Whatever you pick, **build the source map layer yourself** (§1.4). It is
specific to this pipeline and must not live in a dependency you cannot patch.

**Step 1.3.3.** If neither survives, hand-roll with `pizzip` for the archive and
`@xmldom/xmldom` plus `xpath` for the XML. A DOM approach is required — run splitting needs
node-level manipulation, so string templating will not work.

**Step 1.3.4.** Pin the exact version. A silent dependency bump that changes revision
output is a corruption bug shipped to associates.

**8–12 hours.**

## 1.4 Phase 1 — Revision-aware extraction

**Goal:** turn a `.docx` into analysable text plus a map from every character back to the
XML node it came from, preserving any revisions already present.

**Step 1.4.1 — Unpack and parse.** Read the archive. Parse `word/document.xml`,
`styles.xml`, `numbering.xml`, `settings.xml`, `comments.xml` (may be absent),
`[Content_Types].xml`, `_rels/`. Headers and footers frequently carry contract terms —
parse them as separate parts with their own maps.

**Step 1.4.2 — Detect existing revisions.** Scan for `w:ins`, `w:del`, `w:moveFrom`,
`w:moveTo`, `w:rPrChange`, `w:pPrChange`. Record every distinct author, date and total
count. Persist to `analyses`. Surface in the UI — an associate should know at a glance
they are looking at round three, not a fresh contract.

**Step 1.4.3 — Build the three views.**

| View | Includes | Used for |
|---|---|---|
| **Accepted** | bare text + text inside `w:ins`; skips `w:delText` | analysis, source map, all editing |
| **Original** | bare text + `w:delText`; skips `w:ins` | validation, round diffs |
| **Markup** | everything, tagged by revision and author | UI display, round diffs |

Only the accepted view gets a source map. It is the operative contract and the only thing
we modify.

**Step 1.4.4 — Build the source map.** For every character in the accepted view, record
either a real position — `{ part, paragraphIndex, runNodeRef, offsetWithinRun, insideIns,
insideTable, insideContentControl }` — or `synthetic: true`. Synthetic characters are never
modified and never map back. This is what lets you add structure markers without breaking
offsets.

**Step 1.4.5 — Emit structure for the model.** Tables as a Markdown-style grid, headings as
`#` levels, numbered lists with actual numbering. **This matters beyond formatting:**
cancellation schedules and attrition sliding scales are almost always tables, and
flattening them to prose is very likely degrading accuracy on the clauses carrying the
largest dollar exposure. All added syntax is synthetic.

**Step 1.4.6 — Normalise.** In model text only: smart quotes to straight, non-breaking
hyphen and space to ASCII, soft hyphens removed, `w:tab` to `\t`, `w:br` to `\n`. Export
the normalisation function separately — §1.5 needs the identical function.

**Step 1.4.7 — Handle non-text constructs.** Skip `w:instrText` from model text. Mark field
results and `w:sdt` regions as non-modifiable.

**Step 1.4.8 — Determinism test.** Extract the same file 100 times; assert byte-identical
text and identical map. CI test. Everything downstream depends on it.

**Step 1.4.9 — Extraction health gate and intake routing.** *(Opus 5, xhigh)*

A document that cannot be cleanly read must never enter the DOCX revision path. Classify
every document at intake, **before analysis**, not at export.

Run these checks after extraction:

| Check | Fails when |
|---|---|
| Archive integrity | required parts missing, XML fails to parse |
| Text volume | extracted characters implausibly low for the file size |
| Paragraph count | below a floor for a document of this length |
| Encoding health | excessive replacement or control characters |
| Table integrity | table nodes present but rows and cells fail to resolve into a grid |
| Map coverage | any accepted-view character fails to map to a source node |
| Revision integrity | `w:ins`/`w:del` present but malformed or unbalanced |

**Routing:**

| Result | Path |
|---|---|
| All checks pass | **DOCX-native** — analysis on extracted text, tracked-changes export |
| Any check fails | **PDF path** — convert at intake (§1.7), analyse the PDF, export marked-up PDF |
| Legacy `.doc` | **PDF path** always |
| Uploaded PDF | **PDF path** |

Surface the routing decision in the UI when it degrades. The associate should know they
are getting a PDF markup, and why, *before* they spend time reviewing findings.

**Map coverage is the check that matters most.** If any character of the analysable text
cannot be traced back to a source node, the revision engine will eventually try to modify
something it cannot locate. Catching that at intake is far cheaper than catching it at
export.

```sql
ALTER TABLE analyses ADD COLUMN intake_route text;        -- docx_native | pdf
ALTER TABLE analyses ADD COLUMN intake_health jsonb;      -- per-check results
```

**20–30 hours.**

## 1.5 Phase 2 — Revision insertion

**Step 1.5.1 — Locate spans.** Find `quoted_text` in the accepted-view text: exact →
normalised → fuzzy (Levenshtein over normalised text, similarity ≥ 0.95, single best
candidate). Record the tier in `findings.span_resolution`. If the span appears more than
once, disambiguate by proximity to the model's section reference; otherwise mark
unresolved rather than guessing.

**Never ask the model for character offsets.** Models are unreliable at counting
characters. Server-side matching is deterministic and free.

**Step 1.5.2 — Resolve to runs** via the source map.

**Step 1.5.3 — Applicability gate.** Refuse and record the reason if the span crosses a
table cell boundary, sits inside a content control or field result, crosses a paragraph
boundary, or falls inside an existing `w:del`. Write to `findings.applicability`.

**Step 1.5.4 — Split runs.** Split the first and last overlapping runs at the boundaries.
**Clone `w:rPr` into every resulting piece.** This is the single line that preserves
formatting; get it wrong and bold, italic and font changes silently drop.

**Step 1.5.5 — Emit deletion.** Wrap affected runs in `w:del` with author, date, id.
Convert every `w:t` to `w:delText`, preserving `xml:space="preserve"`.

```xml
<w:del w:id="1042" w:author="Jane Associate" w:date="2026-09-06T14:22:00Z">
  <w:r>
    <w:rPr><!-- cloned verbatim from the original run --></w:rPr>
    <w:delText xml:space="preserve">eighty percent (80%)</w:delText>
  </w:r>
</w:del>
```

**Step 1.5.6 — Emit insertion.** Immediately after, a `w:ins` whose run clones `w:rPr` from
the first deleted run.

```xml
<w:ins w:id="1043" w:author="Jane Associate" w:date="2026-09-06T14:22:00Z">
  <w:r>
    <w:rPr><!-- cloned from the first deleted run --></w:rPr>
    <w:t xml:space="preserve">seventy percent (70%)</w:t>
  </w:r>
</w:ins>
```

**Step 1.5.7 — Nested case.** Deleting text the counterparty inserted nests the deletion
inside the existing `w:ins`. Valid OOXML, renders correctly, and the case most likely to
produce a corrupt file. Write the test fixture before the code.

**Step 1.5.8 — Whole-clause insertion.** A new `w:p` needs a paragraph-level insertion
marker in its properties *and* its runs wrapped in `w:ins`:

```xml
<w:p>
  <w:pPr>
    <!-- copy pPr from the neighbouring paragraph for style and numbering continuity -->
    <w:rPr><w:ins w:id="1044" w:author="Jane Associate" w:date="2026-09-06T14:22:00Z"/></w:rPr>
  </w:pPr>
  <w:ins w:id="1045" w:author="Jane Associate" w:date="2026-09-06T14:22:00Z">
    <w:r><w:t xml:space="preserve">...</w:t></w:r>
  </w:ins>
</w:p>
```

Without the paragraph-level marker, Word treats the break as original and numbering goes
wrong.

**Step 1.5.9 — Allocate ids.** Scan for the highest existing `w:id` across all revision
elements and continue. Must be unique document-wide, including against the counterparty's
revisions.

**Step 1.5.10 — Author attribution.** Use the **associate's name**, not the tool's. The
property is negotiating with a person, and this matches practice in legal redlining tools.
The audit log records that the change was tool-generated and associate-approved — that is
where provenance lives.

**Step 1.5.11 — Rationale as Word comments.** Anchor with `commentRangeStart` /
`commentRangeEnd` / `commentReference`, body in `word/comments.xml`. Create the part,
content-type override and relationship if absent. Keep comment text short and factual — the
counterparty reads it.

**Step 1.5.12 — Do not enable `w:trackChanges` in settings.xml** by default. Config flag,
default off.

**30–45 hours.**

## 1.6 Phase 3 — Validation and graceful degradation

Prevents an associate emailing a corrupt file to a hotel. Mandatory, not polish.

**Step 1.6.1 — Structural validation.** Rezip to temp, reopen, assert: every part parses;
revision elements well-formed and correctly nested; all `w:id` unique;
`[Content_Types].xml` and every `_rels` entry consistent with the parts present.

**Step 1.6.2 — The reject-all round trip.** The strongest available check and it is cheap.
Extract the **original view** from the output. It must be byte-identical to the **accepted
view** of the input. In plain terms: rejecting all our changes must return exactly the
document the hotel sent. If it doesn't, we corrupted or lost content. Fail the export.

**Step 1.6.3 — Optional deep check.** Open the output through the LibreOffice worker
(§1.7). If LibreOffice can't render it, Word probably can't either.

**Step 1.6.4 — Three outcomes.** Never all-or-nothing:

| Outcome | Condition | Behaviour |
|---|---|---|
| **Clean** | all applied, validation passes | deliver `.docx` |
| **Partial** | some blocked or unresolved, validation passes | deliver `.docx` **plus** a visible list of what could not be applied, shown before download |
| **Fallback** | validation fails | discard output entirely, route to §1.7 |

**Step 1.6.5 — Log every degradation** to `exports` with a specific reason. Review weekly
during pilot; it is the roadmap for what to fix.

**Step 1.6.6 — Track the degradation rate against a target.** The PDF fallback protects
against catastrophe. It does not protect against mediocrity, and the difference is the
rate:

| Combined intake-PDF-routing + export-fallback rate | Reading |
|---|---|
| Under 5% | Working as intended. The net is a net. |
| 5–15% | Acceptable at launch; fix the top three causes from `fallback_reason` |
| Over 15% | **The engine is not working.** You have shipped a PDF markup tool with extra steps, and the tracked-changes differentiator does not exist in practice. Stop and address it. |

Measure this against the 12-fixture corpus before it is measured against real contracts.

**Step 1.6.7 — Never overwrite the stored original.** Assert in code, not by convention.

**15–22 hours.**

## 1.7 Phase 4 — PDF path

Serves **two** entry points, not one:

- **Intake routing** (§1.4.9) — the document could not be cleanly read, so it is converted
  at upload and analysed as a PDF. The DOCX revision engine is never invoked.
- **Export fallback** (§1.6.4) — the document read cleanly, but the marked-up output failed
  validation, so the output is discarded and a PDF markup produced instead.

The intake case is the cheaper of the two: no wasted revision work, and the associate knows
what they are getting before they start reviewing.

**Step 1.7.1 — Conversion worker.** LibreOffice headless cannot run on Vercel serverless.
Deploy a small container (Fly.io, Railway, Cloud Run) exposing one authenticated internal
endpoint: bytes in, PDF out. **$5–15/month.** New infrastructure dependency; add to the
cost model. Used by both entry points above.

**Step 1.7.2 — Route legacy `.doc` here.** The binary format predates OOXML and cannot be
manipulated by §1.5. Convert on arrival, treat as PDF-path. No tracked changes.

**Step 1.7.3 — Convert and re-locate spans.** Extract text with positional data, re-locate
each accepted finding to page coordinates.

**Step 1.7.4 — Annotate.** Strikethrough on objectionable language, proposed replacement in
a margin callout, rationale in a PDF comment.

**Step 1.7.5 — Cover page.** State plainly this is a PDF markup because the source could
not be safely edited, and list every change in table form so nothing depends on annotations
rendering correctly in the recipient's viewer.

**Step 1.7.6 — Surface the downgrade** to the associate before download, in plain language.

**25–35 hours.**

## 1.8 Phase 5 — Email drafting

Two audiences, deliberately different, from **accepted findings only**.

**Step 1.8.1 — Input assembly.** Findings where the action was accept or edit; use the
edited language where present. Assert dismissed findings absent — unit test, not a comment.

**Step 1.8.2 — Client email.** So the associate does not retype what changed and why it
matters.

- Plain business language; describe substance, not clause numbers
- Group by theme (financial exposure, flexibility, operational), not document order
- State practical impact if the property agrees
- Include quantified exposure figures with their basis
- **Prohibited:** any statement of legal effect, any assurance the client is "protected" or
  "covered", any characterisation of what a clause legally means. Explicit prompt
  constraint, and test it.
- Target one screen. Fourteen findings become thematic summary, not fourteen bullets.

**Step 1.8.3 — Property email.** Transmit the redline with a courteous summary.

- Short: opening, list of items addressed, offer to discuss
- Neutral descriptions — "adjusted the attrition threshold and added resale credit
  language" — not the reasoning
- **Must not include:** exposure amounts, CD's internal standard or fallback position,
  severity ratings, walk-away conditions, or rationale beyond a neutral one-liner. All of
  that is negotiating leverage.
- **Implement as a hard field allowlist on the payload, not a prompt instruction.** A
  prompt can be talked out of it; a filter cannot.

**Step 1.8.4 — Generation.** Same server-side module, two distinct prompts, plain text plus
subject line.

**Step 1.8.5 — UI.** Generate, edit inline, copy to clipboard or download `.eml`. **No
sending from the tool** — standing constraint, and it keeps CD out of deliverability and
mail-authentication problems entirely.

**Step 1.8.6 — Persist** to `email_drafts`; log generation and edits.

**Step 1.8.7 — Voice.** Per-associate signature block and optional tone setting. Associates
have relationships with these properties; a generic voice reads as a form letter.

**18–28 hours.**

## 1.9 Phase 6 — Multi-round hooks

Full diffing is a separate package. Build **linkage and schema now** so data accumulates
from the first pilot contract — retrofitting history is impossible.

**Step 1.9.1 — Explicit thread linkage.** On upload: "new contract" or "revision of…" with
a picker over open threads. Explicit beats fingerprinting; add automatic matching later.

**Step 1.9.2 — Populate** `thread_id`, `round_number`, `parent_analysis_id`.

**Step 1.9.3 — Store the accepted-view text of every round.** Needed for diffing; cheap now.

**Step 1.9.4 — Store the exported file of every round** alongside the received file. Round
N+1 diffs what we sent against what came back.

**Step 1.9.5 — Minimal round display.** Thread view with rounds, dates, finding counts. Not
a diff yet — just the timeline, so the structure is visible and gets used.

**12–18 hours** for hooks. Full diff engine is a further **40–70** — §2.1.1's mechanics
(25–40, ungated) plus §2.1.2's reconciliation (15–30, gated).

## 1.10 Phase 7 — AI-use provision pre-check

**Build now, not later.** Roughly four hours, it is a governance control, and it sits at
the front of the pipeline — adding the gate later means every analysis run before it
existed was ungated.

**Step 1.10.1 — Scan locally, before any network call.** Deterministic regex over extracted
text on CD's own server. Zero transmission. **You cannot use the model to check whether the
model is permitted to read the document.** Same circularity as using AI to strip PII before
sending to AI.

**Step 1.10.2 — Term list.** Case-insensitive, whole-word:

```
\bartificial intelligence\b        \bmachine learning\b
\blarge language model\b           \bgenerative (ai|artificial)\b
\bautomated (processing|decision)  \balgorithmic\b
\bAI\b                             \bLLM\b
\b(text|data) mining\b             \btrain(ing)? (a |any )?model\b
\bnatural language processing\b
```

`\bAI\b` needs true word boundaries or it matches inside "chair", "available", "detail".
Write the false-positive tests first.

**Step 1.10.3 — Block and surface, don't auto-decide.** Halt before analysis, show matching
paragraphs verbatim with the term highlighted. Associate chooses: proceed or abort.

Not a hard block, because most AI clauses in hotel contracts restrict what the *property*
does with attendee data or govern AI use at the event — not internal contract review by the
client's representative. Auto-blocking would produce constant false stops.

**Step 1.10.4 — Record the decision** in `analyses` and the audit log. This is the
compliance artifact: a human saw the clause and made a call.

**Step 1.10.5 — Scan for adjacent language too:** third-party processing restrictions,
confidentiality clauses naming permitted recipients, data residency terms. Feeds the
pending client confidentiality review.

**Step 1.10.6 — Deferred.** Optional second-tier classification sending only matched
paragraphs to the model, with associate consent for that specific transmission. Build only
if the pilot's false-positive rate justifies it.

**4–6 hours.**

## 1.11 Test corpus

Build before Phase 2. **Synthetic contracts only — no CD client documents in the
repository.**

1. Clean simple contract
2. Heavy tables — cancellation schedule, attrition sliding scale, F&B by function
3. Existing tracked changes, one author
4. Existing tracked changes, **two** authors, overlapping
5. Existing tracked changes including `w:moveFrom`/`w:moveTo`
6. Contract terms in headers and footers
7. Multi-level numbered lists with cross-references
8. Content controls and field codes
9. 80-page contract with three addenda
10. Legacy `.doc`
11. Scanned-image PDF, no text layer
12. Deliberately malformed `.docx` that should trigger fallback

**Assertions per fixture:** extraction deterministic; reject-all round trip returns input
exactly; output opens in Word desktop (Windows and Mac), Word on the web, Google Docs and
LibreOffice with revisions correctly attributed; formatting byte-identical outside changed
spans.

Manual render verification across those five environments is not automatable and is not
optional.

## 1.12 Export and email UI consolidation

*(Export picker: Sonnet 5, high. Email audience selector: Opus 5, high.)*

Added 2026-09-09. The analysis header carries six controls, each added on its own
as its feature landed. Collapse them into two.

**One Export button** opening a picker over memo, marked-up PDF, tracked-changes
DOCX and proposed contract, each with a one-line description. Multi-select. The
tracked-changes and proposed-contract paths both run a preflight that can refuse,
and that has to survive — a refusal blocks its own file and lets the others
through, rather than failing the whole batch. Ordinary UI work over routes that
already exist, so Sonnet.

**One Email button** where the associate picks client or property. Opus, because
the consequence is asymmetric. The server-side allowlist means a property draft
still cannot contain severity, exposure or rationale, so the risk is not a leak
through the wrong endpoint — it is an associate sending the client draft, which
carries CD's exposure figures and reasoning, to the property. Nothing downstream
catches that, so the audience has to be unmistakable in the panel, in the draft,
and in the `.eml` filename.

The user overruled §1.8.3's separation of the two audiences on 2026-09-09, on the
grounds that it is the associate's to manage.

## 1.13 Part 1 build order

| # | Work | Model / effort | Branch | Hours | Blocking |
|---|---|---|---|---|---|
| 1 | Library evaluation (§1.3) | Opus 5 · high | `spike/library-eval` | 8–12 | everything |
| 2 | Test corpus fixtures 1–5 | Sonnet 5 · high | `phase/1-11-fixtures` ‖ | 10–14 | Phase 2 |
| 3 | AI-use pre-check (§1.10) | Sonnet 5 · high | `phase/1-10-ai-scan` ‖ | 4–6 | — |
| 4 | Extraction + intake gate (§1.4) | **Opus 5 · xhigh** | `phase/1-4-extraction` | 26–38 | Phase 2 |
| 5 | Validation oracle (§1.6) — **build before the engine** | **Opus 5 · high** | `phase/1-6-validation` | 15–22 | Phase 2 |
| 6 | Revision insertion (§1.5) | **Opus 5 · xhigh** | `phase/1-5-revision-engine` | 30–45 | export release |
| 7 | Test corpus fixtures 6–12 | Sonnet 5 · high | `phase/1-11-fixtures` ‖ | 8–12 | — |
| 8 | PDF path (§1.7) | Sonnet 5 · high | `phase/1-7-pdf-path` | 25–35 | export release |
| 9 | Email drafting (§1.8) | Sonnet 5 · high | `phase/1-8-email` ‖ | 18–28 | — |
| 10 | Round hooks (§1.9) | Sonnet 5 · high | `phase/1-9-threads` ‖ | 12–18 | — |
| 11 | Cross-platform render verification | manual | on `main` after merge | 10–16 | release |
| | **Total** | | | **166–246** | |

‖ = safe to run in a parallel worktree alongside the §1.4/§1.5 critical path (§0.2).

Six to nine weeks focused, three to five months part-time.

**Do not release DOCX export until items 5, 6 and 11 are complete.** A partially validated
revision engine in front of associates emailing files to hotels is the worst available
outcome for adoption.

**New recurring cost:** conversion worker, $5–15/month.

## 1.14 Open questions before starting

1. **Which library** — resolved by §1.3, but decide before Phase 1 so the map interface
   matches.
2. **Multi-paragraph spans** — implement in Phase 2 or block via §1.5.3? Recommend blocking
   for v1 and measuring how often it fires.
3. **Comment volume** — one per change or one per clause? Test with an associate; a
   40-comment document is unreadable.
4. **Signature and tone defaults** — needs one associate's input, not a guess.

---

# PART 2 — FEATURE ROADMAP

**Gated, with four exceptions.** Nothing in Tier 1 or below starts until the accuracy gate
clears, except §2.0.1, §2.0.2, §2.0.3 and §2.1.1, each marked ungated where it appears.
Every gated feature compounds the value of a tool that works and compounds the damage of one
that doesn't.

**§2.0 is not gated** (decided 2026-09-09). The gate conflates three questions, and only
the third needs a senior associate:

1. Can the standards be changed? Yes, today — the admin screen edits them and migration
   `003` fingerprints the exact entries behind every analysis.
2. Does the machinery correctly apply whatever standards it is given? Testable now, and
   largely tested — §1.4/§1.5/§1.6 verify document mechanics that never read a position.
3. Are CD's positions right? Unknown. Only a senior associate can say.

So the gate is a **claims-and-deployment gate, not a code gate**. What it must stop is
presenting this as "how ConferenceDirect negotiates" and putting it in front of real deals.
It need not stop building machinery whose correctness does not depend on the positions being
right. The concrete gap the gate closes is visible in the code — all 25
`walk_away_condition` values in `lib/standards/v1.ts` are empty strings, and
`position`/`severity_default` have never been checked against a real deal outcome.

## 2.0 Ungated foundations

Three items, none of which depends on the accuracy gate. Build these while the senior
associate review is unavailable.

### 2.0.1 Eval harness

*(Opus 5, high)*

Build order item 2 from the build brief, deferred at the user's request and now the highest-
leverage work available. The day a senior associate reviews 25–30 contracts and produces an
answer key, there is currently nothing to run it against — so the scarcest resource in the
project would wait on engineering.

Build the scoring machinery now against a **synthetic** answer key over the §1.11 fixtures,
whose ground truth is known by construction. CD's real key then arrives as a data swap, not
a build.

Opus because a scoring bug is silent by nature. A harness that mis-matches findings reports
an accuracy number that looks fine and is wrong, and there is no downstream symptom to catch
it — the same reason §1.11's assertion suite design was assigned Opus.

**20–30 hours.**

### 2.0.2 Structured term extraction

*(Opus 5, xhigh)*

**Read this before scoping anything else in Part 2.**

Four roadmap features — deadline extraction, the what-if calculator, savings quantification
and executive summaries — all depend on the same missing capability: extracting the
contract's **actual parameters as typed values**, not just findings.

Findings tell you "the attrition threshold is unfavourable." Terms tell you
`attrition_threshold = 0.90`, `measurement_basis = "night_by_night"`,
`liability_rate = 1.00`, `resale_credit = false`, `room_block = 340`, `adr = 289.00`.

Build this once, as a separate extraction pass with its own schema and its own validation:

```sql
CREATE TABLE contract_terms (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL,
  term_key text NOT NULL,              -- attrition_threshold, cancellation_tier_3_pct, ...
  term_value jsonb NOT NULL,           -- typed: number, date, boolean, enum, schedule array
  unit text,                           -- pct | usd | rooms | days | date
  source_section text,
  quoted_text text,
  confidence text,
  extracted_at timestamptz DEFAULT now()
);
```

**Do not build any of the four dependent features before this exists.** Doing so means four
parallel ad-hoc extractions that disagree with each other, and the disagreement will surface
in a client-facing document.

**Term extraction layer: 30–45 hours.** Plus its own answer key, verifying extracted values
against 15–20 contracts, because a wrong ADR silently corrupts every downstream number.

**That answer key does not need a senior associate** (decided 2026-09-09). Confirming that a
contract reading 90% was extracted as `0.90` is reading comprehension, not negotiating
expertise — anyone literate can check it, and the §1.11 fixtures have known ground truth by
construction. This is what makes §2.0.2 ungated. The four dependent features stay gated.

### 2.0.3 Client-portability seams

*(Opus 5, high — UI strings: Sonnet 5, high)*

Raised by the user 2026-09-09: if CD does not buy the tool, retooling for another company in
the same space should be cheap. Three layers, and only the third is client-specific:

| Layer | Example | Scope |
|---|---|---|
| Document mechanics | extract, locate, redline, validate, export | client- and industry-agnostic |
| Clause taxonomy | attrition, cancellation, force majeure | industry-specific |
| Negotiating positions | `position`, `fallback_language`, `walk_away_condition` | client-specific |

Layer 3 already lives in the `standards` table with provenance and versioning, and
`clause_type` is unconstrained `text` in the database, so the schema is portable today. Two
seams are not:

- **`ClauseType` is a compile-time union of 25 hotel clause types** (`lib/standards/
  types.ts`), fusing the taxonomy into the build. Fine for another hotel-side client; wrong
  for another vertical.
- **"ConferenceDirect" is hardcoded in four prompt sites** in `lib/anthropic.ts` — the
  analysis tool description, the analysis system prompt, and both email prompts. §1.8.3 added
  the fourth. This cost grows with every new prompt site, so parameterising the org name is
  cheap now and steadily less so later.

Opus for the prompt and taxonomy work, because changing the analysis system prompt silently
changes the output of every review. The UI string replacements are ordinary Sonnet work.

Acceptance test for the split: **the pipeline runs end to end against a dummy standards set
and still produces structurally valid output.** If it cannot, layers 1 and 3 are entangled.

**15–25 hours.**

---

## Tier 1 — Build first after the gate

### 2.1 Multi-round diff engine

Prerequisite for §2.3 and §2.4. Hooks already exist from §1.9. Split in two, because only
the second half depends on the findings being right.

#### 2.1.1 Diff mechanics — **not gated**

*(Opus 5, xhigh)*

Comparing what we sent against what came back is document work, and its correctness does not
depend on CD's positions. Two diff paths, because properties return documents both ways:

1. **Counterparty used track changes** — their edits are labelled by author; read directly
2. **Counterparty returned a clean document** — very common; diff the current-view text
   against the version we sent, map changed regions back to clauses

Same reasoning as §1.4/§1.5 for the model assignment — a mis-mapped region silently
attributes a change to the wrong clause.

**25–40 hours.**

#### 2.1.2 Reconciliation into findings — **gated**

*(Opus 5, xhigh)*

Reconcile each prior finding into `finding_outcomes`: accepted, partially accepted,
countered, rejected, unchanged. Plus a separate bucket for issues newly introduced in text
that was not there before — the case associates fear, where the property concedes on
attrition and quietly tightens cancellation.

Gated, because "the property rejected this finding" is only meaningful once the finding
itself is known to be right.

**15–30 hours.**

### 2.2 Deadline extraction and calendar export

Cutoff dates, room block review dates, cancellation tier boundaries, attrition measurement
dates, deposit schedules, F&B guarantee deadlines. Timeline view, export to `.ics`.

**Why early:** these are the dates that cost real money when missed, they currently live in
spreadsheets and memory, and the value is obvious on day one. Extends the tool's usefulness
past the review hour into the eighteen months the contract governs.

Depends on §2.0. **20–30 hours** on top of the term layer.

### 2.3 Negotiated value quantification

**The highest-value and highest-risk feature in this document. Read §2.3.1 before building.**

Calculate what the negotiation achieved, measured from the property's original draft to the
current or final version.

**Three buckets, never combined into one number:**

| Bucket | Contents | Framing |
|---|---|---|
| **Committed value** | Fee waivers, rate reductions, comp room ratios improved, F&B minimum reduced, rebate/commission rate changes, resort fee removal | Money that will definitely be saved or earned. Safe to call savings. |
| **Contingent exposure reduced** | Attrition liability, cancellation liability, F&B shortfall damages | Liability avoided **only if the triggering event occurs.** Never call this savings. |
| **Risk improved, not quantified** | Force majeure language, walk/relocation provisions, construction disclosure, audit rights, cutoff review dates, indemnification | Listed and described. No number attached, ever. |

**Contingent exposure must be expressed as a scenario table, not a single figure:**

| Pickup | Exposure — original draft | Exposure — negotiated | Reduced by |
|---|---|---|---|
| 100% | $0 | $0 | $0 |
| 90% | $9,826 | $0 | $9,826 |
| 80% | $19,652 | $0 | $19,652 |
| 70% | $29,478 | $9,826 | $19,652 |

This is both more honest and more useful to an associate than a single number, because it
shows where the protection actually bites.

**Baseline:** primary comparison is against the property's original draft. Secondary
display: remaining gap to CD standard, which shows what was not achieved. Showing both
keeps the feature from becoming purely self-congratulatory.

**Calculators required per clause type** — each individually small, collectively the bulk of
the work: attrition (threshold, basis, liability rate, resale credit), cancellation (tier
schedule × date), F&B (minimum, service charge and tax gross-up), mandatory fees (per room
night, per person), rebates and commission, deposit schedule (time value, minor).

**2.3.1 — The framing decision, and why it matters**

This number **will** be used. It will end up in client reports, RFP responses, CD marketing
and associate performance reviews. Once it is used that way, an inflated methodology becomes
a liability rather than an embarrassment.

The specific trap: "savings" implies money that would otherwise have been spent. Attrition
liability is contingent — it materialises only if the group underperforms. Reporting
"$47,000 saved" when the likely actual outcome was zero attrition penalty is misleading, and
a sophisticated client will say so.

Requirements:

- The three-bucket separation is structural, enforced in the data model, not a UI
  convention
- Every figure carries its basis and its assumptions, visible not buried
- A written methodology document, reviewed and signed off by senior associates, exactly as
  the standards library is
- **All arithmetic in the calculation engine. The model never computes.** It may narrate
  around numbers the engine produced.
- Its own answer key: 10–15 past negotiations where CD knows what was achieved, checked
  against the associates' own assessment before this is shown to anyone outside CD

**Also note the framing discipline:** a savings figure edges toward a financial claim in the
same way that clause explanation edges toward legal advice. The methodology disclosure is
what keeps it on the right side.

Depends on §2.0 and §2.1. **Calculation engine 25–40 hours, UI 15–25 hours,** plus the
methodology document and validation.

### 2.4 Executive summaries

Three variants from the same structured data:

| Variant | Audience | Content |
|---|---|---|
| **Round-over-round** | Associate | What changed between v2 and v3 and what it means. Working document. |
| **Cumulative** | Client | Original property draft → current. Business language, impact-focused. Overlaps §1.8.2; share the generator. |
| **Final / closing** | Client file and record | Complete arc, original terms vs executed terms, value achieved, outstanding risks accepted. |

**The final summary is the highest-value output of the entire tool from CD's business
perspective.** It goes in the client file, attaches to the post-event report, and is what an
association board sees when asking what their meetings agency actually did for them. That is
a client-retention artifact, not an internal efficiency one.

**Design rule:** generate from structured data — findings, outcomes, term deltas, calculated
values — not by re-reading documents. Terms comparison is a deterministic table; the model
writes only the narrative connective tissue. Otherwise you get plausible-looking wrong
arithmetic in a client-facing document.

**Prohibited in all variants:** statements of legal effect, assurances of protection,
characterisation of what clauses legally mean. Same constraint as §1.8.2, same tests.

Depends on §2.0.2, §2.1, §2.3. **25–40 hours.**

### 2.5 Pre-signature verification

Before signing, re-run against the final version and confirm every negotiated change
survived. Properties sometimes return a "clean final" differing from what was agreed —
occasionally by accident.

Uses §2.1. Will eventually catch something expensive, and that single catch is the story
that sells the tool internally.

**15–25 hours.**

### 2.6 Learn tab

Guided teaching content on CD's positions: what each clause type does, why CD takes the
position it takes, the fallback ladder, worked examples with real numbers.

**Generate from the standards library** so it cannot drift out of date when the library is
revised. Link every finding to its explainer — "why does CD ask for cumulative attrition
measurement" is one click from the flag.

**On hiding the library from associates:** the original framing was teaching without
exposing the library. That protection is illusory — every finding already states CD's
position, and twenty contracts reconstructs most of it. The useful distinction is curated
teaching material versus raw reference data. A new associate needs a guided path; a senior
associate wants to look up exact fallback language without waiting for a finding to fire.
Recommend read access for experienced associates, with the departing-associate concern
handled in the associate agreement rather than the UI.

**30–45 hours**, mostly content.

---

## Tier 2 — Aggregate data features

What a CD-specific tool can do that no generic product can. All depend on outcome data
accumulating, so they arrive naturally 6–12 months after pilot.

### 2.7 Property negotiation history
"You have negotiated with this property six times. They concede on attrition, never on F&B
minimums, and their standard force majeure is weaker than market." Built from
`finding_outcomes`. **25–40 hours.**

### 2.8 Benchmarking against CD's own book
"This attrition threshold is worse than 78% of comparable CD contracts in this market this
year." A lever the associate uses in conversation. At 11,000 contracts a year the sample is
real — but do not ship on 200 contracts. **30–50 hours.**

### 2.9 Exposure rollup
Total exposure across an associate's open contracts or a client's event portfolio. Does not
exist anywhere at CD today. Likely valuable to association clients in quarterly reviews,
making it a client-retention feature. **25–40 hours.**

---

## Tier 3 — Smaller additions

### 2.10 What-if calculator
"What do we owe at 70% pickup", "what does cancelling at 120 days cost". Associates do this
in spreadsheets today. Depends on §2.0.2 and shares §2.3's calculators. **15–20 hours.**

### 2.11 On-demand clause language
Pull CD's preferred language for any clause type even when nothing was flagged. Small
feature, high daily use. **8–12 hours.**

### 2.12 Escalation routing
Flag for senior associate or outside counsel review with findings attached. Does double
duty: workflow, and it makes the "this is not legal advice, here is how you get actual
review" path explicit in the product rather than only in a disclaimer. **15–25 hours.**

---

## Deliberately not building

**Free-form chat about the contract.** Cheap and tempting, and the feature most likely to
produce something reading as legal advice. If built, scope to factual retrieval ("what does
section 7 say about cutoff"), never interpretation.

**Contract lifecycle management.** Storage as system of record, approval workflows,
e-signature. Ruled out in `BUILD_BRIEF.md` §3, likely overlaps something CD already runs,
and it is how a focused tool becomes a mediocre platform.

**Autonomous sending.** Standing constraint.

---

## Deferred infrastructure

- **CD security environment integration** — SSO/IdP, cloud tenant hosting, security review.
  Blocked on confirming how CD's environment works.
- **Client-identifier redaction** — only if the confidentiality review requires it.
- **Subscription and entitlement layer** — required if CD charges associates a monthly fee.
  Self-serve signup, status checks on every analysis, payment handling or an admin toggle,
  and a decision about stored contracts when someone lapses. **30–50 hours.** Also triggers
  the commercialization clause in the build agreement.

## Part 2 effort summary

| Item | Model / effort | Hours |
|---|---|---|
| §2.0.1 Eval harness **(ungated)** | **Opus 5 · high** | 20–30 |
| §2.0.2 Term extraction layer **(ungated, prerequisite)** | **Opus 5 · xhigh** | 30–45 |
| §2.0.3 Client-portability seams **(ungated)** | **Opus 5 · high** | 15–25 |
| §2.1.1 Diff mechanics **(ungated)** | **Opus 5 · xhigh** | 25–40 |
| §2.1.2 Reconciliation into findings | **Opus 5 · xhigh** | 15–30 |
| §2.2 Deadline extraction | Sonnet 5 · high | 20–30 |
| §2.3 Negotiated value quantification | **Opus 5 · xhigh** (UI: Sonnet 5) | 40–65 |
| §2.4 Executive summaries | Opus 5 · high (UI: Sonnet 5) | 25–40 |
| §2.5 Pre-signature verification | Sonnet 5 · high | 15–25 |
| §2.6 Learn tab | Sonnet 5 · high | 30–45 |
| §2.7–2.9 Aggregate features | Sonnet 5 · high (§2.8: Opus 5) | 80–130 |
| §2.10–2.12 Smaller additions | Sonnet 5 · high | 38–57 |
| **Total** | | **353–562** |

Of that, **§2.0.1, §2.0.2, §2.0.3 and §2.1.1 — 90–140 hours — are ungated** and can start
before any senior-associate review.

This is a multi-year roadmap. Sequence it against evidence from the pilot; do not commit to
it wholesale.

---

# PART 3 — HANDOFF DOCUMENTATION PLAYBOOK

Produce before the sale closes. Roughly **25–35 hours** of writing, and the difference
between a clean transfer and eighteen months of unpaid questions.

## 3.1 Security overview

Six to eight pages, written before anyone asks. Most contractors do not produce this, and
producing it unprompted shortens a security review dramatically.

- Data flow diagram — where a contract goes from upload to deletion, and every company that
  touches it
- Vendor list with compliance pages, and confirmation CD holds a DPA with each
- Encryption at rest and in transit
- Access control model, enforced at the database level
- Audit logging — the strongest item in the document
- Retention and deletion, including what happens when an associate leaves
- Backup and recovery
- Incident response: who is called, how fast

## 3.2 Runbook

Executable by someone who is not the author.

- Deploy and rollback
- Rotate any credential
- Restore from backup
- **Re-run the evaluation harness after a model change** — the single most important
  procedure in the document
- Update and version the standards library
- Diagnose a failed analysis
- Read the export degradation log and interpret fallback reasons

## 3.3 Architecture document

- System diagram and request lifecycle
- Data model with reasoning behind non-obvious choices (`library_version`, `provenance`,
  `finding_actions`, `contract_terms`)
- Why PDFs go inline rather than through the Files API
- Why the source map is re-derived rather than persisted
- Known limitations and constructs that trigger PDF fallback

## 3.4 Standards library maintenance guide

For a senior associate, not a developer. How to add, edit and retire entries, what each
field means, what `provenance` values signify, how to read override data to find where the
library is wrong.

## 3.5 Value calculation methodology

If §2.3 was built: the written methodology, senior-associate signed off, with the
three-bucket separation, per-clause formulas, stated assumptions, and explicit limits on how
figures may be described externally.

## 3.6 Recorded walkthrough

Thirty minutes of screen recording beats ten more pages. Cover a full analysis end to end,
the admin screens, a deploy, and one deliberate failure with diagnosis.

## 3.7 The acceptance test

**Someone who is not the author clones the repository, follows the runbook, and deploys a
working copy to staging without asking a single question.**

If that fails, the handoff is not complete — the system still lives in one person's head. If
CD has nobody technical who could run this test, raise it before the sale closes: it means
the support agreement is not optional.

---

# PART 4 — HANDOFF EXECUTION

Seven vendor relationships transfer, each with billing attached. Goal: end as a **named
collaborator on CD's accounts and the owner of none of them.**

## 4.0 Prerequisite — CD names a billing owner

One person holding the card and the cost center. Everything below is blocked on this, and
it is usually the slowest step because it is a budget conversation, not a technical one.

**Owner: CD.**

## 4.1 Anthropic

First, because it gates real contract processing.

1. CD creates the organization under CD's name and billing
2. CD signs commercial terms and the DPA
3. Set a monthly spend cap before any key is issued
4. Separate workspaces for production and development, each with its own key and cap
5. Developer added with a **developer** role — not admin, not billing

**Owner: CD, developer assisting.**

## 4.2 GitHub

1. CD creates an organization
2. Transfer the repository — transferring preserves commit history and issues
3. Developer added as member with write access to that one repository, not org owner

**Owner: joint.**

## 4.3 Supabase

Fiddliest step. Do not attempt an in-place transfer.

1. CD creates an organization and a new Pro project
2. `pg_dump` the database, import to the new project
3. Copy stored files across
4. Re-run migrations and diff the schema to confirm parity
5. Have pilot associates sign in again rather than migrating auth internals
6. **Verify row-level security policies survived** — test with a non-admin account

**Owner: developer, CD provides the account.**

## 4.4 Vercel

1. CD creates a Pro team
2. New project pointed at CD's repository
3. Set environment variables from a password manager, never pasted into chat
4. Deploy and test on the temporary Vercel URL before touching DNS
5. Developer added as a member seat — $20/month, belongs in the support agreement rather
   than arriving as a surprise

**Owner: developer, CD provides the account.**

## 4.5 Transactional email

Easy to forget, long lead time.

1. CD creates an account with Resend, Postmark or SES
2. **CD IT adds SPF, DKIM and DMARC records** authenticating the sending domain — without
   this, login and notification emails land in spam for 450 people
3. Verify deliverability to a sample of real associate addresses before launch

**Owner: CD IT. Raise four weeks before cutover.**

## 4.6 Error monitoring

CD creates a Sentry account; developer added as member. Trivial, but do not leave it in a
personal account collecting stack traces containing client data.

**Owner: joint.**

## 4.7 Conversion worker

If §1.7 was built: CD creates the Fly.io or Railway account, developer deploys, internal
endpoint authenticated against CD's application only.

**Owner: joint.**

## 4.8 Domain

Last, because DNS is the cutover moment.

1. CD provides the subdomain
2. CD IT adds the record
3. Verify TLS issues correctly
4. Test from outside CD's network

**Owner: CD IT.**

## 4.9 Rotate every secret

Twenty minutes, and the clean answer to any question about lingering access.

- New Anthropic keys, old ones revoked
- New Supabase service role and anon keys
- New email service key
- New Sentry DSN
- New conversion worker credentials
- Any credential that touched a personal machine is dead

**Owner: developer, verified by CD.**

## 4.10 Access model after handoff

| System | Developer role | Notes |
|---|---|---|
| GitHub | Write on one repository | Not org owner |
| Vercel | Member seat | $20/month, in the support agreement |
| Anthropic | Developer | Not admin, not billing |
| Supabase | Standing access to **staging only** | Production granted on request |
| Sentry | Member | |
| Billing | **None, anywhere** | |

Production access on request rather than standing is what a security reviewer wants to hear,
and it protects the developer — you cannot be blamed for a data issue in an environment you
cannot reach.

## 4.11 Support agreement

Separate from the build contract:

- Hourly rate or prepaid block
- Model migrations quoted as fixed items, expected two or three times a year
- Response-time commitment
- **Offboarding clause** — what happens if the developer becomes unavailable, and explicit
  confirmation CD can engage someone else without penalty. Writing this clause yourself
  signals you are not trying to trap them, which is worth a great deal in a related-party
  sale.

## 4.12 Name a CD counterpart

Someone at CD receives tickets and decides what gets fixed. Without this, every request
routes to the CEO — the dynamic to avoid.

**Owner: CD. Condition of handoff, not a nicety.**

## 4.13 Two questions for CD IT with long lead times

Ask now; answers take weeks.

1. **Does CD require a third-party security assessment for new applications?** If so, budget
   four to eight weeks of calendar time and a few thousand dollars, paid by CD.
2. **Has CD made commitments to clients in RFPs about contract data handling** that this
   tool must satisfy?
