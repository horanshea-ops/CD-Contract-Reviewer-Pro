# Core audit

The user's goal of 2026-10-08. The plan and its rules are in ROADMAP.md under
"Core audit". This file holds the findings, one section per piece.

No fix here is built without its own plan and the user's yes.

## Piece 1. Changes left out of the redline

Audited 2026-10-08 on `phase/1-5-table-cells-in-place`.

### Evidence

| Source | What it shows |
|---|---|
| Free replay of 25 stored Word reviews, every business finding treated as accepted | 653 findings. 601 applied, 52 left out. No oracle check failed. |
| The live export record | 34 exports. 31 clean, 3 partial, 0 fell back to the PDF. |
| Reviews run on Sonnet 5.5 (`model_id` on each review) | 4 of the 25, holding 188 findings. 185 applied, 3 left out. |

The 21 other reviews ran on Sonnet 5, most on prompts since changed. They show
what the engine can meet. The four Sonnet 5.5 reviews show what the beta will
meet. Four is a small sample, and three of the four are the same contract.

### Why the 52 were left out

| Reason | Count | On Sonnet 5.5 | Verdict |
|---|---|---|---|
| A blank left in the proposed wording | 31 | 3 | Fix (1.1) |
| A table row proposed as a sentence | 5 | 0 | Keep the refusal, watch (1.3) |
| A rewrite that runs across paragraphs | 4 | 0 | Fix in the engine (1.2) |
| A rewrite with no quote to replace | 7 | 0 | Keep the refusal (1.4) |
| Quoted wording not found | 4 | 0 | Keep the refusal (1.5) |
| Quoted wording found more than once | 1 | 0 | Keep the refusal (1.5) |

### Findings

**1.1 Blanks are 60% of everything left out, and all of it on Sonnet 5.5.**

- The model writes `[X]` where it lacks a figure. The engine won't send a hotel wording with a blank in it.
- The 31 fall into three groups.

| Group | Count | State |
|---|---|---|
| A blank copied from the standards library (vendors, audit dates, F&B minimum, master account, labor) | 18 | Closed. The library was filled, a test guards it, and no review since 2026-09-09 shows one. |
| The gratuity percentage | 9 | The user reworded the standard on 2026-10-08. The one review since shows no blank. Watch the next review. |
| A figure only the deal can supply (room nights, a tier's dollar amount, square feet, ceiling height) | 4 | Open. Two of the three Sonnet 5.5 cases are here. |

- Proposed fix, free. The card shows each blank as a field the associate fills. A filled change goes into the redline. An unfilled one stays out, as now.
- This is a decision only the associate can make, so it belongs on the card. It replaces today's yellow box, which tells the associate to open Edit and find the blank.
- Alternative, paid. Tell the model to take figures from the contract and to write wording that needs no figure when the contract has none. It needs a Riverwalk run (about $0.30), and the model may still leave a blank.
- Question for the user. Does CD ever send a hotel wording with a blank for the hotel to fill? If so, some blanks could go out as they are.
- Risk of the free fix is low. It is card work and touches no engine code.
- **Built 2026-10-08 on `audit/1-1-blank-fields`, not merged.**
  - The card shows one field per blank with the words around it, and one button, "Save and accept". A filled blank is saved as an ordinary edit.
  - The yellow box for blanks is gone. Accept is absent while a blank is unfilled.
  - One function (`blanksIn` in `lib/redline-engine/wording.ts`) finds blanks for the card and for the engine's own check.
  - Lint, the type check and 1,643 tests pass. The replay of 25 reviews matches the table branch on every review.
  - Seen in the dev browser on Harborview (`a70ff3c5`). Both blank cards show their fields and no Accept, and the other 77 cards are unchanged.
  - Not checked in the browser: the save itself, which writes to the shared database and needs the user's yes. It reuses the Edit route.
  - A real contract can produce a blank (user's question, same day). Two of the four deal-specific blanks came from the redacted Florida contract. The cause is CD's standard asking for a figure the contract doesn't state.

**1.2 The engine can't replace wording that runs across paragraphs.**

- 4 of the 52. The model quoted a passage across a paragraph break and proposed a rewrite of it.
- The same gap sends a two-line table cell to the struck table and its copy, and it is the cause of the one skip left after the cell-by-cell change (`table_holds_comment`).
- Proposed fix, free. One new route in the engine. It strikes the old wording in each paragraph, inserts the new wording in the first, and marks the emptied paragraph breaks as deleted so they close up when the hotel accepts.
- Word writes the same thing when a person selects two paragraphs and types.
- It would remove the 4, the struck table's first trigger, and the `table_holds_comment` skip. The struck table would then serve one case, a second finding that changes wording the first already changed. It could be retired after that, which removes about 300 lines.
- Risk is real. Deleted paragraph breaks are where Stage 0 found corrupt files. It is §1.5 work with its own plan, proven on the replay and by a look in Word.
- Priority is medium. It has not fired on Sonnet 5.5 yet.
- **Measured 2026-10-08, and held. It waits on one test in Word.**
  - The oracle, the clean copy and both PDFs already handle a deleted paragraph break. The engine route itself is small.
  - In all four stored cases the first and last paragraphs carry different formatting. Three start on a numbered paragraph and end on an indented sub-point.
  - When a hotel accepts the change, Word joins the paragraphs into one, and that one takes the formatting of either the first or the last. Which one is not known here. Word's rule changed between versions, and nobody on the project can press Accept, since the user's Word is view-only.
  - If the guess is wrong, the new wording loses its clause number and sits indented as a sub-point. The words would be right and the layout wrong.
  - A route limited to paragraphs with the same formatting would be safe under either rule. It would cover none of the four stored cases.
  - **The test.** `data/private/replay/word-check-accept-all.docx`, opened in a Word that can edit (Word for the web is free with a Microsoft account). Press Accept All and answer the two questions in the file. `word-check-original.docx` is the comparison for Reject All.
  - The same sitting closes "Accept All and Reject All, untested by a person", which covers everything the engine writes today.
  - **The user ran the test on 2026-10-09, in Word for the web.**
    - Accept All put AAA and BBB on one centred line, and left NEW WORDING as numbered clause 2 with no indent. Joined paragraphs take the first paragraph's formatting.
    - Reject All put every paragraph back as the original has it.
    - Desktop Word, which hotels mostly use, was not tested.
  - **Built 2026-10-09 on `phase/1-5-across-paragraphs`, not merged.**
    - The engine strikes the old wording in each paragraph, inserts the new wording in the first, and deletes the breaks between. A last paragraph that keeps wording after the quote stays its own paragraph.
    - A table cell holding several paragraphs takes a rewrite in place by the same route. The struck table and its copy now serve one case, a second finding changing wording the first already changed.
    - The route declines when the paragraphs don't sit side by side, when a break is a section break or carries the hotel's tracked change, when the passage holds wording the hotel struck, or when it overlaps an earlier change.
    - **The clean copy was wrong and is fixed.** It gave a joined paragraph the next paragraph's formatting. Word gives it the first's. No export took that path with real content. A test now rebuilds the user's Word file and checks the clean copy against the screenshot.
    - Lint, the type check and 1,658 tests pass.
    - Replay of 25 reviews against the blank-fields branch. Applied changes go from 601 to 605. All four stored cases apply, no review loses a change, every oracle check passes, and no review uses the table copy.
    - A made-up sample waits for an Accept All and Reject All in Word for the web: `data/private/replay/sample-across-paragraphs-redline.docx`, with its `-original` beside it.
    - Limit. A whole-passage rewrite strikes all the old wording. It doesn't leave shared words unmarked.
  - Found on the way. The document reader treats a paragraph whose break is deleted as still separate. A hotel file with a tracked deletion across paragraphs reads with a stray blank paragraph, and a stray list number if it was numbered. For piece 4.

**1.3 A table row proposed as a sentence is refused, and should be.**

- 5 of the 52, all on Sonnet 5. The proposal read "731 Days or More: $11,890.20 [...]; $0 Food and Beverage Cancellation Fee."
- Laying a sentence into columns means guessing which words go where.
- Sonnet 5.5 has not done this in four reviews. The user decided on 2026-10-08 that the prompt item for it stays out.
- No work. Count it on each new review.

**1.4 The no-quote rewrite guard is still needed.**

- 7 of the 52. A finding marked "missing" proposed wording the contract already had.
- Without the guard the appendix would add a second copy of a clause.
- Four come from the one run that returned no quotes (`c7148b08`). The other three predate 2026-10-03, when a quote became required. None since.
- No work.

**1.5 The "not found" and "found more than once" refusals are the model's quoting errors.**

- A quote shortened with "...", a whole table quoted as one line, a row quoted with the next row's figure, and the single word "Office", which appears 10 times.
- None on Sonnet 5.5. The engine can't know what the model meant.
- No work.

**1.6 Two refusal reasons can never appear.**

- `spans_non_text_content` and `in_header_footer` are in the list of reasons, with their text for the associate. The engine produces neither.
- Proposed fix. Remove both with the old engine (1.7).

**1.7 The old redline engine is dead code.**

- `lib/tracked-changes-docx.ts` (322 lines) is imported by nothing in the app. One Stage 0 script (`scripts/validate-live-engine.ts`) and one test file (`tests/tracked-changes.test.ts`) use it. The fuzz script already runs the new engine.
- ROADMAP.md records it as deleted on 2026-09-08. The file, the script and the test are all still in the repository.
- CLAUDE.md deviation 4 kept it switched on until the new engine passed every fixture. No fixture falls back to the PDF today.
- Proposed fix. Delete the file, its script and its test, and close deviation 4. Each of the old test's seven cases is checked first for a matching case on the new engine.
- Risk is low. Needs the user's yes, since it ends a deviation.

**1.8 One reason covers five different causes.**

- `crosses_boundary` is used for a row that won't lay out, a paragraph break, a table edge, a table the copy can't carry, and a cell that holds several paragraphs.
- Its text tells the associate to rewrite the row with `|`. That helps one of the five.
- Belongs to piece 2. If 1.2 is built, three of the five causes go away.

**1.9 The oracle has a blind spot for some tracked-change records.**

- Its id check counts insertions, deletions and moves. It doesn't count a tracked formatting change, a tracked paragraph change or a tracked cell change.
- Found on 2026-10-08. New wording was copying a hotel's formatting-change record and repeating its id, and the oracle passed it. The engine is fixed. The oracle still wouldn't catch a second case.
- Proposed fix, free. Count every record that carries an id and an author, and fail only on a repeat the export added. A hotel's own file may already hold repeats.
- It is §1.6 work with its own plan. Risk is low, and the replay proves it.
- **Held 2026-10-08. It also waits on a look in Word.**
  - The engine itself repeats such an id today. When a quote starts partway through wording a hotel reformatted, the run is split, and each piece keeps the hotel's formatting record with the same id.
  - A wider check would send those exports to the PDF. Whether Word minds a repeated formatting-record id is not known.
  - **The test.** `data/private/replay/word-check-ids.docx` holds two pieces with one id. If Word opens it with no repair message, the repeat is harmless and this fix is dropped. View-only Word is enough.
- **Dropped 2026-10-09.** The user opened the file and Word showed no repair message. The fix would guard against a problem Word doesn't have.

**1.10 A crash was live, and a crash gives the associate an error where a failed check gives the PDF.**

- The crash is fixed on the branch. A refused change could split a run, and a later finding on the same run threw.
- When the engine throws, the export returns an error (`loadRedline` in `lib/exports/redline.ts`). A failed oracle check sends the associate to the marked-up PDF.
- Proposed fix. A throw takes the PDF route as well, and is logged with its cause. Piece 5 confirms what the associate sees today.

**1.11 The oracle and the fallback are doing their job.**

- No check failed across 25 replays, and no live export has fallen back.
- No check looks unneeded. None is proposed for removal.

**1.12 "Leaves out a sentence" has not appeared since quotes became required.**

- 31 applied changes dropped a sentence the proposal repeated from the contract. All are from 2026-10-03 or before. The five reviews since show none.
- The code that handles it (`lib/redline-engine/restated.ts`) stays. It protects the contract from losing a sentence.
- No work. Count it on each new review.

### Proposed order

| # | Fix | Cost | Needs |
|---|---|---|---|
| 1 | Merge the cell-by-cell table branch, which carries the crash fix | Done, waiting | The user's look at two files in Word |
| 2 | Blanks as fields on the card (1.1) | Built, not merged | The table branch merged first |
| 3 | Replace wording across paragraphs (1.2) | Built, not merged | The two branches below it merged first |
| 4 | Widen the oracle's id check (1.9) | Dropped | Word opens a repeated id with no complaint |
| 5 | Remove the old engine and the two dead reasons (1.6, 1.7) | Free, small | A yes, since it closes deviation 4 |
