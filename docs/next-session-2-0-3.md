# Carryover prompt — §2.0.3 client-portability seams

Copy everything below the line into a new session.

---

Finish §2.0.3 (client-portability seams) in the CD Contract Reviewer repo at
/Users/sheahoran/Documents/GitHub/ContractReviewPro.

## Model check first

MASTER_PLAN.md §0.1 assigns §2.0.3 to **Opus 5, high**. The prompt work
specifically requires Opus — changing the analysis system prompt silently changes
the output of every review. State which model you are running before writing any
code, and stop if it is not Opus 5.

## Branch

`phase/2-0-3-portability-seams` off current main. Never work on main. Use plan mode
and get the plan approved first, per CLAUDE.md.

## What §2.0.3 is for

If CD does not buy the tool, retooling for another company in the same space should
be cheap. Three layers, only the third client-specific:

| Layer | Example | Scope |
|---|---|---|
| Document mechanics | extract, locate, redline, validate, export | client- and industry-agnostic |
| Clause taxonomy | attrition, cancellation, force majeure | industry-specific |
| Negotiating positions | `position`, `fallback_language`, `walk_away_condition` | client-specific |

Layer 3 already lives in the `standards` table with provenance and versioning, and
`clause_type` is unconstrained `text` in the database, so the schema is portable
today.

## What is already done

- **UI strings** — done, commit b41c20b. `lib/org.ts` exports `ORG_NAME`.

## What is left — two seams

**1. Four prompt sites still hardcode "ConferenceDirect"** in `lib/anthropic.ts`:

| line | site |
|---|---|
| ~46 | `FINDINGS_TOOL_SCHEMA` description |
| ~111 | `buildSystemPrompt` — the analysis system prompt |
| ~276 | `buildClientEmailPrompt` |
| ~408 | `buildPropertyEmailPrompt` |

`lib/org.ts` exists but none of these use it. The cost of this grows with every new
prompt site — §1.8.3 added the fourth — so it is cheap now and steadily less so.

Note the prompts also use the short form "CD" throughout, not just the full name.
Decide how both are parameterised.

**2. `ClauseType` is a compile-time union of 25 hotel clause types** in
`lib/standards/types.ts`, which fuses the taxonomy into the build. Fine for another
hotel-side client; wrong for another vertical.

It is referenced in only 7 files, so this is narrower than it sounds — check before
assuming a large refactor. Several of those are in `lib/eval/`, which already uses
plain `string` for clause types deliberately.

## Acceptance test

**The pipeline runs end to end against a dummy standards set and still produces
structurally valid output.** If it cannot, layers 1 and 3 are entangled. That is the
test §2.0.3 names, and it is the thing to build toward.

## SPEND RULES — read before any API call

The user is spending from a small prepaid balance and has asked to keep API calls to
a minimum.

- **Never make an API call without quoting a price first and getting a yes.** That
  includes single-contract runs.
- Quote the price for the **whole** of something, not per unit — "all 7 contracts
  will cost about $X", not "about $Y each".
- Propose free or cheaper alternatives before proposing a paid run.
- Output tokens cost 5× input ($10/M vs $2/M on Sonnet 5), so cost tracks how much
  the model writes, not how much it reads.

Measured costs, for estimating:

| | cost |
|---|---|
| One contract through the review pipeline | $0.04–0.16 (varies with findings) |
| All 7 contracts | ~$0.65 |
| Rebuilding the eval corpus from saved drafts | **$0.00** |
| Re-scoring any captured run | **$0.00** |

Roughly $3.50 has been spent on this work so far. The user's retrospective view is
that generating synthetic contracts was not worth it, and that **if contracts are
needed again, they would rather supply them** — an answer key can then be built by
reading them, which costs nothing.

## Tools you have

§2.0.1 built an eval harness, merged to main. It measures whether the pipeline
applies the standards it is given.

```bash
npm run eval:capture -- --label <name>                  # costs money, ask first
npm run eval:capture -- --label <name> --only a.docx,b.docx   # subset
npm run eval:score  -- --run <name>                     # free, offline
npm run eval:score  -- --run <name> --audit             # free, shows every pairing
npm run eval:build-corpus -- --resume                   # free when drafts exist
```

`docs/eval-harness.md` explains how it works and how CD's real key swaps in.
`docs/eval-baseline-2026-09-10.txt` is the last full report.

**This is directly useful for §2.0.3's acceptance test.** A capture against a dummy
standards set, scored against the existing key, tells you whether the pipeline
survived the split — but note a dummy library will legitimately produce different
findings, so read the structural result (did it run, were quotes locatable, was the
output well-formed), not the accuracy rates.

## Environment gotchas

- **DNS on this machine intermittently fails to resolve api.anthropic.com.** It
  presents as "Request timed out", "terminated", or "Connection error". The code is
  usually fine — the same call often succeeds on its own a minute later. Both
  `eval:capture` and `eval:build-corpus` retry and take `--resume`, so a dropped
  connection costs seconds rather than a run.
- `npm run typecheck`, `npm run lint`, `npm test` all run in CI. Baseline is **601
  tests passing**. Lint has one pre-existing warning in `lib/docx/walk.ts` — not
  yours, leave it.
- CI deliberately does not run `next build`, which needs live Supabase credentials.

## Open items NOT in scope here

In ROADMAP.md under "Raised by the first eval run". Do not pick these up unless asked:

- **Narrow-margin deviations dropped ~2 times in 9.** Variance at the decision
  boundary, not a fixed blind spot. Needs several runs to measure, so it is not worth
  touching until there is a reason to spend on a batch.
- **Three known defects in the eval corpus** — an ambiguous F&B shortfall directive,
  an over-simplified auxiliary-aids meaning, and an over-restrictive assignment clause
  in eval-03. They depress precision because the key cannot see them. Fix them the
  next time the corpus is rebuilt for another reason, not on their own.
- **Vercel deploy.** Measured analysis times: median 89s, range 34–229s, 10 of 13
  runs over 60s. Hobby's 60s function limit is not viable. Pro's 300s default covers
  the median but the tail gets close.
