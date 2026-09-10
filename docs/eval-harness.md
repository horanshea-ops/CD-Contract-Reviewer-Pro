# Eval harness

MASTER_PLAN.md §2.0.1. Measures whether the review pipeline is accurate, against an
answer key.

## What it measures

**Whether the pipeline correctly applies the standards it is given.** Not whether CD's
positions are right.

The synthetic key derives from `lib/standards/v1.ts` — the same library the model reads at
analysis time. So a perfect score means the review applied that library correctly. It says
nothing about whether the library encodes the right positions. Only a senior associate's
review answers that, and it arrives as a different key run through the same scorer.

This is the split MASTER_PLAN.md's Part 2 preamble uses to ungate §2.0: question 2, not
question 3.

## Running it

```bash
npm run eval:build-corpus     # writes the contracts and the key. Costs tokens. One time.
npm run eval:capture          # runs the review over them. Costs tokens. Repeat per measurement.
npm run eval:score -- --run 2026-09-09
npm run eval:score -- --run 2026-09-09 --audit
```

| Step | Cost (measured 2026-09-10) | Deterministic |
|---|---|---|
| `eval:build-corpus` | ~$0.35, one time | Yes, given the same drafts |
| `eval:capture` | ~$0.95 per run | No — this is the thing being measured |
| `eval:score` | free, no network | Yes |

Capture cost is dominated by output, not input: 79k output tokens against 76k input.
That is a consequence of the model filing a finding per clause examined rather than per
problem found — see the baseline below. Fixing that cuts the bill as well as the noise.

Both commands take `--resume`. A build reuses any contract whose drafted clauses are
already on disk; a capture reuses any contract already analysed under that label. Both
exist because DNS on the build machine intermittently fails to resolve `api.anthropic.com`,
and a dropped connection should cost seconds rather than a whole run.

`eval:build-corpus --only <spec-id>` builds one contract without touching the key. Use it
to look at prose before paying for the rest.

`eval:capture --model <id>` measures a different model. `--label <name>` names the run file.

## How ground truth works

Contracts are not read to find out what they say. They are **written from a spec that
already says it**.

```
spec (typed terms)  ──►  directives  ──►  drafted prose  ──►  DOCX
       │                                                        │
       └──► CD positions ──► key items ──► anchors ◄─────────────┘
```

1. `corpus/specs.ts` states every negotiable term of every contract as a typed value.
2. `corpus/positions.ts` restates CD's prose positions as checks a number can be compared
   against. Severity is never restated there — the key reads `severity_default` from the
   live library, so a library change reaches the key without touching that file.
3. `corpus/derive-key.ts` compares the two. Each deviating clause becomes one key item.
4. `corpus/draft.ts` has a model write the prose, then refuses it unless it survives the
   gate below.
5. Anchors are located in the built DOCX, and the key points at them.

### The integrity gate

A contract whose prose drifted from its spec produces a key that is confidently wrong, and
a wrong key reports a correct review as inaccurate with nothing downstream to contradict
it. Six checks:

| Check | Catches |
|---|---|
| Anchor sentence is a substring of the prose | A sentence the model claimed but did not write |
| Dictated figure is in the anchor sentence | A paraphrased number |
| No markdown or list markers | Prose that is not contract prose |
| Anchor resolves in the built DOCX at `exact` or `normalized` | Wording that did not survive OOXML |
| No two anchors from different clauses overlap | Wording a finding could attribute to either clause |
| A second, stronger model reads the contract back and agrees with the spec | A boolean term written backwards |

The last one exists because obligations have no literal handle. "The Hotel keeps resale
proceeds" and "resale proceeds are credited to Group" differ in meaning, not in any string
the gate could check for. Numbers and enum values are dictated word for word and checked
by substring; booleans are given as meaning and left to the drafter's wording, so the
contracts are not fifteen copies of one template.

Failures retry the failing **clause**, not the whole batch — a batch retry rerolls clauses
that were fine and gives a different one a fresh chance to drift.

## How scoring works

### Identity is location, never a graded field

A finding is placed in the document first, using `locateQuote` from
`lib/redline-engine/locate.ts` — the same function §1.5 uses to decide where a redline
goes. Only then are its attributes graded.

Pairing on clause type instead would make "right issue, wrong clause type" impossible to
observe. It would become a miss plus a false positive, and clause-type accuracy would read
as perfect on exactly the findings that got it wrong.

Clause type is the fallback, used only where location evidence is missing on one side — a
missing-clause key item has nowhere to point, a missing-clause finding quotes nothing, and
a quote appearing several times resolves nowhere. The fallback works across kinds
deliberately, so a present clause the model called missing pairs and grades as a presence
error.

Clause-name aliases are an explicit table in `match.ts`, not string similarity. A
similarity threshold pairs findings the harness cannot justify and prints the result as
fact. An unlisted name simply does not match, and the report shows it with the name the
model used, so the table grows from real output.

### Pairing is optimal, not greedy

One finding is often the best candidate for two key items, and taking the wrong one costs
a second pair. `hungarian.ts` solves it exactly; it is checked against exhaustive search
over 1000 random matrices rather than against examples, because a wrong assignment returns
a slightly worse pairing rather than crashing.

### Outcome buckets

| Bucket | Meaning | Counts against precision |
|---|---|---|
| `matched` | Paired | — |
| `missed` | Nothing pointed at it | — |
| `conflated` | A matched finding already covered its wording | — |
| `duplicate` | Points at a key item another finding took | Yes |
| `spurious` | Matches nothing, key is exhaustive | Yes |
| `unscored` | Matches nothing, key is not exhaustive | No |

### Graded dimensions

Each on its own, because they fail on their own.

| Dimension | Notes |
|---|---|
| Clause type | Via the alias table |
| Presence | `is_missing_clause` |
| Severity | Exact / over-called / under-called, plus signed distance and a confusion matrix |
| Quote | `exact` / `normalized` / `fuzzy` / `unlocatable` / `ambiguous`, from `locateQuote` |
| Exposure | `required` / `forbidden` / `unspecified` per key item; a figure on a `forbidden` clause is `invented` |
| Proposed language | Only where the key asserts something checkable — its own denominator |

**Language grading is deliberately narrow.** Numeric checks convert directly and a curated
set of enum checks convert to phrases. Boolean checks assert nothing, because a clause that
should add a resale-credit obligation has a dozen correct rewrites and no phrase list
covers them. Asserting one anyway would report the assertion's narrowness as the model's
error. The report prints the denominator so the rate is read for what it is.

## Swapping in CD's real key

The scorer never imports the synthetic key — a test asserts this. Replacing it is a data
swap:

1. Write the reviewer's findings as an `AnswerKey` (`lib/eval/types.ts`) with
   `source: "cd_review"`.
2. Set `exhaustive: false` on each contract. A reviewer was not asked to list everything,
   so unmatched findings go to `unscored` instead of counting as false positives. This one
   flag is what lets the same scorer read both kinds of key.
3. Anchors need `part`, `start`, `end` into the extracted text of the real contract. Use
   `locateQuote` on the wording the reviewer quoted.
4. `expected_language` may be empty. Every other dimension still grades.
5. `npm run eval:score -- --run <label> --key path/to/cd-key.json`

## Known limits

- **Seven contracts, 90 key items.** Enough to make per-clause and per-severity breakdowns
  mean something. Not enough to read a single percentage as a forecast. Eight more specs
  are written and held in `RESERVE_SPECS`; widening the corpus is moving an id into the
  active list and rebuilding.
- **The contracts share a generator.** Drafted from the same directives by the same model,
  so they are more alike than seven real hotels' paperwork. A model that scores well here
  has not proved it reads unfamiliar drafting.
- **Exposure is mostly ungraded.** Only a disclosed resort fee has an amount that follows
  from stated figures in one step. Elsewhere the key takes no position rather than grade
  its own arithmetic.
- **Header and footer terms are keyed for one clause type.** `cutoff_date` is restated in
  the footer of contracts whose style carries terms there. Other clauses are body-only.

## First baseline, 2026-09-10

`claude-sonnet-5`, standards `v1-industry-default`, 7 contracts, 90 key items.
Full report with the audit trail in `eval-baseline-2026-09-10.txt`.

| | |
|---|---|
| Recall | 96.7% (87/90) |
| Weighted recall | 97.1% |
| Precision | 48.9% |
| Clause type correct | 100% (87/87) |
| Presence correct | 98.9% |
| Severity exact | 49.4%, within one band 95.4% |
| Quoted text | 75 exact, 0 unlocatable |

**The judgment is good and the output shape is not.** The review found 87 of 90
real problems, named every clause type correctly, and never fabricated a quote.
It also filed 88 spurious findings.

Reading them shows why. On `eval-03-bayfront`, which has two real problems, it
filed 25 findings — and the extra 23 say things like:

> `finding_text`: "Governing law/venue is Group's home state, no punitive damages,
> each party bears own fees — fully matches CD's standard. Compliant."
> `proposed_language`: "No change recommended; clause aligns with CD standard."

So the model is using `findings` as a record of every clause it examined, and
`clauses_checked` for the same thing. Its conclusion about the clause is right;
it is recorded in the wrong field. That matters because everything downstream —
the redline engine, the memo, the property email — reads `findings` as a list of
things to act on, so a "no change recommended" entry becomes a proposed change.

Fixing it is a prompt change and belongs with the other prompt work, not here.
The harness now measures whether a fix worked: re-capture and compare precision.

Severity is the other soft spot. Half the calls are exact and 95% are within one
band, but the model over-calls more than it under-calls (29 against 15), and 23
of the key's `medium` items came back `high`.

**Three genuine misses**, all `medium`, all present-but-adverse clauses rather
than missing ones — `named_storm` in eval-01, `fb_minimum` in eval-10,
`mandatory_fees` in eval-15.
