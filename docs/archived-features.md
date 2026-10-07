# Archived features

The beta tests the core contract review. Three features are off the live build
and kept in the repository (user, 2026-10-06). ROADMAP.md's "Beta preparation"
section holds the decision.

## How archiving works here

- The code stays in the tree. It still compiles, and its tests still run in CI.
- A switch that defaults to off hides each feature. Off means no nav link, a
  "not found" page, and 404 from the API routes.
- No table, column, stored file or migration is removed.
- Tag `archive/2026-10-06-pre-beta` (commit `abf5eff`) is the last commit with
  all three features live.

| Feature | Switch | Default | State |
|---|---|---|---|
| Analytics tab | `ANALYTICS=on` | off | Archived |
| Historical contract uploads | `HISTORICAL_CONTRACTS=on` | off | Archived |
| Exposure math | `EXPOSURES=on` | off | Hidden on screen and in the client email since 2026-10-07. Still worked out and stored until the Sonnet 5.5 branch merges. |

## Analytics tab

| | |
|---|---|
| What it did | A firm-wide library of signed contracts, with charts of terms by brand, market and date, a page per property, and a term-sheet PDF per contract |
| Code | `lib/analytics/`, `components/analytics/`, `app/(app)/analytics/`, `app/api/analytics/` |
| Tests | `tests/analytics.test.ts` |
| Data | `historical_contracts` and `contract_terms`, both untouched |
| Related switches | `ANALYTICS_SOURCE=test` shows generated records. A production build also needs `ANALYTICS_DEMO=on`. `ANALYTICS_SHARE_ORIGINALS=on` opens original files to every associate. |

**Restore.** Set `ANALYTICS=on` on the host.

**State when archived.**
- It has only ever shown generated test data on the live site.
- Its database source reads historical uploads that have a hotel, city, signed
  date and tier, so it shows nothing real until historical uploads are read.
- Signed contracts from reviews do not feed it yet.

## Historical contract uploads

| | |
|---|---|
| What it did | The Admin tab's first screen. An admin dropped any number of past contracts. Each file's text was read locally, and the Batch service filled in the hotel, brand, place, client, dates and terms. |
| Code | `lib/historical/`, `app/(app)/admin/contracts/`, `app/api/admin/historical/`, `app/api/historical/` |
| Tests | `tests/admin-historical.test.ts` |
| Data | `historical_contracts`, `historical_batches`, and files under `historical/` in the `contracts` bucket, all untouched |
| Related switches | `HISTORICAL_EXTRACTION=on` allows the model read. It has never been on. |

**While archived.** The Admin link opens Users, with no tab strip. The old
address, `/admin/contracts`, was where Admin used to open, so it sends an
admin to Users instead of a "not found" page.

**Restore.** Set `HISTORICAL_CONTRACTS=on`. The Admin link opens Historical
contracts again, with Users as the second tab. Set `HISTORICAL_EXTRACTION=on`
as well once the app runs on CD's own Anthropic API key.

**State when archived.**
- The model read has only run against mocks. No real batch has been sent.
- The Batch service is outside zero data retention (29-day retention).
- A scanned PDF with no text layer cannot have its quotes checked, so its
  details land in "Needs a look".

**Shared with the beta.** `readContractText`, which turns a PDF, DOCX or DOC
into text locally, moved out of this folder to `lib/read-contract-text.ts`. The
upload confirm step and historical uploads both import it from there.

## Exposure math

| | |
|---|---|
| What it did | Dollar exposure for attrition, cancellation and F&B, worked out by the app from figures the model quoted. Shown on the finding card, the clause card, the review's overview bar and the client email. |
| Code | `lib/exposures/`, `lib/exposure.ts`, `lib/review.ts`, `lib/findings-overview.ts`. The switch is `lib/exposures/enabled.ts`. |
| Tests | `tests/exposures/`, `tests/exposure.test.ts`, `tests/findings-overview.test.ts` |
| Data | `findings.exposure_amount`, `exposure_basis` and `exposure_formula`, kept on every existing review |

**Why it was archived.** The arithmetic never varied. The figures the model read
off the page did. One Florida contract gave $170,696, $91,724, $121,524,
$157,524, $65,800 and $36,000 across six runs. During the beta the associate
quantifies the risk. Findings still state the contract's numbers and CD's.

**What stays live.** `lib/document-checks.ts` and `lib/date-checks.ts` check
the contract's own totals and dates. That is checking the hotel's sums, and it
is separate from exposure.

**While archived, on `main` today.** No figure shows on the finding card, the
clause card, the overview bar or the client email (`withoutArchivedExposure`
in `lib/exposures/enabled.ts`). A review still asks the model for the
contract's figures and stores the exposures it works out.

**While archived, once the Sonnet 5.5 branch merges.** A review is two model
calls (`lib/review.ts`). The
reading call asks for five terms only: the room block, the minimum room nights,
the attrition threshold, the F&B shortfall rate and the commission rate. They
feed the three findings the app raises itself when the review drops them
(`lib/must-raise.ts`). No finding carries a dollar figure, and the second ask
for cancellation tiers never fires. A review run before the archive keeps its
stored figures, and the screen and the client email leave them out
(`withoutArchivedExposure`).

**Restore.** Set `EXPOSURES=on`. The reading call asks for the full exposure
list again, figures are computed and shown, and stored figures on older reviews
reappear. Nothing else needs changing. Read "State when archived" first, since
the reasons it was shelved still stand.

**State when archived.**
- A percentage is verified when its quote holds that number anywhere.
- The reader's answer on what a cancellation percentage is charged on varies
  from run to run.
- An exposure needs a finding to sit on, and the review sometimes writes none.
- Exposures need a stated total of room nights. A contract whose room block is
  a picture gives none.
