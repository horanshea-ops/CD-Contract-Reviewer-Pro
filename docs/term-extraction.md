# Term extraction

MASTER_PLAN.md §2.0.2. Reads a contract's actual parameters as typed values, so
deadlines, the what-if calculator, savings and executive summaries all compute from
one extraction instead of four.

Findings say "the attrition threshold is unfavourable". Terms say
`attrition.threshold = 0.9`.

## Moving parts

| File | Role |
|---|---|
| `lib/terms/catalog.ts` | The hotel catalog: 81 terms, each typed, each with a one-figure meaning |
| `lib/anthropic.ts` → `extractContractTerms` | The model call. Reading, not reviewing |
| `lib/terms/validate.ts` | Normalises, rejects, verifies against the document, groups repeats |
| `lib/terms/extract.ts` | One pass end to end, plus the `contract_terms` rows and the pass record |
| `lib/analysis-pipeline.ts` | Runs a pass alongside each review when switched on |
| `supabase/migrations/006_contract_terms.sql` | `contract_terms` table, `analyses.term_extraction` column |
| `lib/eval/terms/` | Key-agnostic scorer and report |
| `lib/eval/corpus/derive-terms-key.ts` | Builds the synthetic key from the eval specs |

## The catalog

- Industry layer only. It lists which terms exist and how each is typed, never what a good value is.
- Keys are `<group>.<field>`, where the group is a clause type or `deal`.
- Kinds are `number` (with a unit), `enum`, `boolean`, `date` and `schedule`.
- Percentages are stored as fractions, so 90% is `0.9`.
- Each meaning names exactly one figure. A named-storm clause carries a 72-hour trigger and a 24-hour notice deadline, and only a precise meaning says which to record.
- Another vertical writes its own catalog. The extraction code reads no term by name.
- Version is `hotel-v1`. A drift test keeps it aligned with the eval corpus's fields.

## Verification

Every stored value is checked against the text the model read.

| Status | Meaning | Usable downstream |
|---|---|---|
| `verified` | Quote is in the document and contains the value | Yes |
| `located` | Quote is in the document; the value has no figure to check (boolean, enum, schedule, zero stated in words) | Yes |
| `contradicted` | Quote is in the document and states a different figure | No |
| `unlocated` | Quote is not in the document | No |

- **Rule for the four dependent features:** compute only from `verified` and `located`. The other two are kept so an associate can see them.
- Entries that can't be stored are rejected with a reason, recorded in `analyses.term_extraction.rejected`. Causes include an unknown key, a wrong type, a value out of range, and a missing quote.
- The same value stated twice is stored once. Different values for one key are all stored, and the key is listed in `conflicts`.
- Every catalog key the contract doesn't state gets a `not_stated` row.
- **Limit.** A quote holding two figures of the same unit passes verification whichever one the model picked. Only the answer key catches that, and it is reported as silent-wrong.

## Turning it on

Off by default. Nothing reads terms yet.

1. Paste `supabase/migrations/006_contract_terms.sql` into the Supabase SQL Editor and run it.
2. Set `TERM_EXTRACTION=on` in `.env.local`.
3. Each upload then runs a pass alongside the review. That costs about $0.08 per upload on Sonnet 5.

- The pass runs after the AI-use gate, so a held contract reaches the model through neither call.
- A failed pass never fails the review. The failure is recorded in `analyses.term_extraction`.
- Re-running an analysis replaces its term rows.

## Measuring

```bash
npm run eval:terms:key                                          # free — rebuild the key
npm run eval:terms:capture -- --label <name>                    # costs tokens
npm run eval:terms:capture -- --label <name> --only eval-01-harborview.docx
npm run eval:terms:capture -- --label <name> --model claude-haiku-4-5
npm run eval:terms:score -- --run <name>                        # free
npm run eval:terms:score -- --run <name> --audit                # every term not scored correct, with its quote
```

| Outcome | Meaning |
|---|---|
| `correct` | The one value stated matches the key |
| `wrong_value` | One value stated, and it isn't the key's |
| `conflict` | Several different values stated. Visible to the associate |
| `missed` | Key has a value, extraction stated none |
| `invented` | Key says not stated, extraction stated a value |
| `correct_absent` | Both say not stated |

- **Silent-wrong** counts wrong or invented values that still passed verification. It is the headline, because those are what a downstream calculation would use.
- Capture reads each DOCX through `contractText`, which is exactly what production sends.

## The synthetic key

- 7 contracts, 525 stated values, 33 deliberately absent terms.
- Clause terms come from the specs, read back through the phrasing the drafter was given. The key holds the figure the contract prints.
- The schedule, the rate, the block and the dates come from what the layout printed.
- Unkeyed, with the reason in the key file:
  - `deal.fb_minimum_usd`, which the layout never prints
  - `deal.peak_night_rooms` in table-heavy contracts, where the room-block table contradicts the prose
- `tests/eval/terms-perfect-run.test.ts` feeds the key back as a flawless model answer and scores it against the real DOCX text. It must score 100%, with every non-zero figure verified.

## Hand-keying a real contract

MASTER_PLAN asks for 15–20 keyed contracts. Seven are synthetic. The rest can be real ones, keyed by reading them. That needs literacy, not negotiating expertise.

1. Put the DOCX in `data/private/contracts/`. The folder is gitignored.
2. Write `data/private/terms-key.json` in the same shape as the synthetic key, with `"source": "hand"`.
3. List only terms you've checked. Use `"not_stated"` where the contract is silent. A term left out isn't scored.
4. Capture and score:

```bash
npm run eval:terms:capture -- --label real-1 --key data/private/terms-key.json --corpus data/private/contracts
npm run eval:terms:score -- --run real-1 --key data/private/terms-key.json
```

With `--key`, run files are written beside the key, in `data/private/terms-runs/`. They hold quotes from the real contract, so they stay inside the ignored folder with no step to remember.

## Known limits

- **33 absent terms is a thin test of invention.** Real contracts leave out far more.
- **The prompt says "hotel or venue".** That wording is industry-specific in the same way as the analysis prompt (§2.0.3).
- **PDF uploads verify against positioned-line text.** Hyphenation at a line break can leave a sound quote unlocated.
- **Schedules keyed by calendar date aren't modelled.** The bands are days before arrival. A contract that dates its tiers needs the arrival date to convert, and the extractor won't guess it.
