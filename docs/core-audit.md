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
- **Done 2026-10-10**, with 1.7.

**1.7 The old redline engine is dead code.**

- `lib/tracked-changes-docx.ts` (322 lines) is imported by nothing in the app. One Stage 0 script (`scripts/validate-live-engine.ts`) and one test file (`tests/tracked-changes.test.ts`) use it. The fuzz script already runs the new engine.
- ROADMAP.md records it as deleted on 2026-09-08. The file, the script and the test are all still in the repository.
- CLAUDE.md deviation 4 kept it switched on until the new engine passed every fixture. No fixture falls back to the PDF today.
- Proposed fix. Delete the file, its script and its test, and close deviation 4. Each of the old test's seven cases is checked first for a matching case on the new engine.
- Risk is low. Needs the user's yes, since it ends a deviation.
- **Done 2026-10-10 on `audit/1-7-remove-old-engine`, not merged** (user's yes, same day).
  - The engine, its script and its test are deleted, 717 lines in all. CLAUDE.md deviation 4 is closed.
  - Each of the old test's ten cases has a matching case on the new engine, so none was ported.
  - Lint and the type check pass. The test count went from 1,658 to 1,648, which is the ten deleted cases.
  - No file imports the deleted one, and nothing names the two removed reasons.
  - The replay of 25 reviews matches the branch below on every review.

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
| 5 | Remove the old engine and the two dead reasons (1.6, 1.7) | Done, not merged | The three branches below it merged first |

## Piece 2. What the associate is shown

Audited 2026-10-10 on `audit/1-7-remove-old-engine`. This pass covers the review card and the review screen. The export dialog, the two email panels and the new-review form are a second pass.

### Evidence

Every stored Word review's cards were worked out as the screen works them out today, read-only.

| | Sonnet 5 (21 reviews) | Sonnet 5.5 (4 reviews) |
|---|---|---|
| Findings | 666 | 255 |
| Business, legal, other | 469, 141, 56 | 189, 43, 23 |
| Yellow box, an amount that doesn't follow from its formula | 0 | 6 |
| Yellow box, a table row not split by column | 8 | 0 |
| Yellow box, a rewrite with nothing quoted | 7 | 0 |
| Yellow box, leaves out a sentence | 21 | 0 |
| Yellow box, wording reads as an instruction | 0 | 0 |
| Blank to fill (a field since finding 1.1) | 29 | 3 |
| Notes on the document, per review | not counted | 4 to 7 |

### Findings

**2.1 On Sonnet 5.5 one yellow box is left, the amount check.**

- It fired 6 times, on 2 of the 4 reviews. Five are the tiers of one cancellation schedule.
- The other four card warnings did not fire once in 255 findings. On Sonnet 5 they fired 36 times in 666.
- Their code stays. Each one stops a change that would misplace wording or repeat a clause. Count them on each new review.

**2.2 The amount check is something to read, with nothing to do.**

- The box says "Check this amount. At 70% × 5% of the contract's $339,720.00 base it would be $11,890.20. The wording says $10,586.15."
- The associate has to open Edit, find the figure and retype it. Blanks worked this way before finding 1.1.
- Proposed fix, free. Two buttons under the message, "Use $11,890.20" and "Keep $10,586.15". The first saves the wording with the new amount as an edit. The second records that the associate looked, and the box goes.
- The user decided on 2026-10-08 that the check warns and doesn't hold the change out. That stays.
- Risk. The check can be wrong when the contract's own arithmetic is off, or when the amount rests on another change. So the choice stays with the associate and nothing is applied on its own.
- It is card work and reuses the Edit route. "Keep" needs somewhere to record the choice, which the plan must settle.
- The user said on 2026-10-10 that this is fine to try.
- **Built and merged to `main` on 2026-10-10** (`audit/2-2-amount-buttons`).
  - The box keeps its sentence and carries "Use" the worked-out amount and "Keep" the amount as written. It is no longer yellow.
  - "Use" saves an edit. "Keep" saves an accept, or saves an associate's edit again as it stands. Nothing new is stored.
  - The box shows while the change is undecided and goes once either is pressed. Plain Accept is absent while it shows.
  - The worked-out amount is written the way the wording writes its own, with or without cents.
  - Lint, the type check and 1,660 tests pass. The check's arithmetic is unchanged.
  - Seen in the dev browser on `4a7e89f6` (one card, "Use $35,000.00" and "Keep $80,000.00") and `4f803f16` (five cards, one of them with two amounts). No card on either review shows a yellow box.
  - Not clicked: either button's save, which writes to the shared database. Both reuse the accept and edit route.

**2.3 The notes on the document are reading with no decision.**

- Each Sonnet 5.5 review carries 4 to 7. Examples are "Contract dates contradict each other" and "The $80,000 F&B cancellation fee does not match its stated formula."
- No export uses them. The memo, both emails and the redline never see a note.
- Some are worth raising with a hotel, and the screen gives no way to do it.
- This belongs with the question already waiting on CD, which findings earn a card. Two routes for the user to choose between.
  - Each note gets "Raise with the property" and "Dismiss", and a raised note reaches the client email and the memo.
  - Notes stay as they are, closed under a count, as reference.
- No work until the user chooses.
- **The user's choice, 2026-10-10.** The notes stay as they are until CD gives direction.

**2.4 The card's check is a second copy of the engine's rules, and it can't see the Word file.**

- `lib/redline-engine/preflight.ts` restates the engine's rules against the stored review text, so a card can speak before export.
- It can't foresee a refusal that needs the Word file. Those are wording not found, wording found twice, an overlap with another accepted change, a locked field or content control, and paragraphs or a table the engine can't join or copy.
- Such a refusal first appears in the export dialog. The user's rule is that problems are not handled there.
- How often. On Sonnet 5.5, none in 188 business findings. On Sonnet 5, five in 469 after this week's fixes.
- Proposed fix, free. Run the real engine as a dry run when the review screen loads, and let each card show what the engine did with it. The card and the export then can't disagree, and about 200 lines of restated rules go.
- Cost. One engine run per load, about a second on a 1.2 MB file, cached until a decision changes.
- To settle in its plan. The engine's answer depends on which findings are accepted together, so the dry run has to say what it assumes about undecided ones.
- Priority is low on today's numbers. Do it if the beta shows refusals the card didn't foresee.
- **The user overruled the priority on 2026-10-10.** An associate who has decided every change should not learn at export that one has no place, and "raise it another way" is not an instruction. The order of the steps is wrong however rarely it bites.
- **Built and merged to `main` on 2026-10-10** (`audit/2-4-check-before-export`).
  - **The check runs early.** When a Word upload's review screen loads, the server runs the redline engine and its oracle over every change that isn't dismissed. Each card shows the engine's own answer.
  - **A change with no place can't be accepted as it stands.** Its card says why and offers a way to settle it.

    | What is wrong | What the card offers |
    |---|---|
    | The quote is in several places | Each place, with "This one" |
    | The quote isn't in the contract | "Show me where". The associate selects the wording in the document pane, sees the change against it, and confirms |
    | Two changes cover the same words | "Keep this one" and "Keep the other", each naming the other change |
    | A row that won't split, a locked part of the file, and the rest | The engine's sentence, with Edit |
    | Any of the above but an overlap | "Send this in the email to the property" |

  - **Sent by email is done by the app.** The property email's draft carries a list of those changes after the model's text, written by code in fixed words. The model's payload is unchanged and never holds them. A test pins that the list carries the clause, the contract's wording and the proposed wording, and none of CD's position.
  - **The export screen lists nothing.** If a file's check still finds an accepted change with no place, the row says how many and takes the associate to the card. It offers no download of a file that lacks one.
  - **The whole-file case is announced early.** The review screen says up front when the Word file would fall back to the marked-up PDF.
  - Migration 018 adds three columns to a decision: the wording picked, the wording before it, and the email choice. Placing a change accepts it, as filling a blank does.
  - Lint, the type check and 1,717 tests pass. The replay places the same 605 changes on all 25 reviews.
  - Timing on the 25 stored reviews. The check took 1.7 seconds at worst, download included, and is cached until a decision changes it.
  - Seen in the dev browser with nothing saved. `65f10383` lists the 10 places "Office" was found. `c27f414d` took a selection in the document pane and showed the change against it. Neither card offers Accept.
  - **Three departures from the plan.**
    - The card's older check (`lib/redline-engine/preflight.ts`) is not deleted. A PDF or .doc upload has no Word file to run the engine on, and still uses it.
    - Both PDFs still list a change with no place after the contract. That list is the net under a Word file that falls back, and it is inside the file, not on the export screen.
    - "Show me where" is offered only where the quote is the trouble. A row that won't split into its columns needs an edit, not a selection.
  - Migration 018 was applied by the user on 2026-10-10, and its columns were confirmed present.
  - **One save checked in the dev browser, with the user's yes.** On `65f10383`, "This one" on the first of the 10 places. The save returned 200, the card read "Accepted" with the places gone, and it read the same after a reload, when the server ran the engine again from the saved row. The row holds the quote "Office" and the wording before the 27/09/2027 table row.
  - Not checked in the browser: "Show me where" with its confirm, "Keep this one" and "Keep the other", and "Send this in the email to the property". Each writes to the shared database.
  - **To watch (user, 2026-10-10).** When a change with no place first shows up on a real review, look at each one on its own. Record the contract's wording, the model's quote, and what the card offered.

**2.5 One export message gives advice that fits one of its causes.**

- The text for `crosses_boundary` tells the associate to rewrite the row with `|`. After this week's fixes the reason still covers a row that won't lay out, paragraphs that can't be joined, wording that leaves its table, and a table the copy can't carry.
- The engine already writes one specific sentence per case, stored on the finding.
- Proposed fix, free and small. The export dialog shows the engine's own sentence. Finding 2.4 would make this unnecessary.
- It has not fired on Sonnet 5.5.

**2.6 "Also strikes wording the finding didn't quote" is checked on the export screen.**

- When a change is widened to a whole sentence, the export dialog asks the associate to check it before sending.
- None on Sonnet 5.5. Six on Sonnet 5.
- By the user's rule this belongs on the card. Finding 2.4 would put it there. No separate work.

**2.7 Read and found sound.**

- The blank fields, "Flag for client" on a legal finding, the hotel's tracked-changes strip, the comments button, and the notice when a review falls back to Independent's standards.
- None of the four Sonnet 5.5 reviews tripped the fallback notice or the AI-use check.

### Proposed order

| # | Fix | Cost | Needs |
|---|---|---|---|
| 1 | Buttons on the amount check (2.2) | Done, on `main` | Nothing |
| 2 | A decision on the document notes (2.3) | None | Left as they are until CD gives direction (user, 2026-10-10) |
| 3 | The engine's own sentence in the export dialog (2.5) | Free, small | A plan and a yes |
| 4 | The engine as the card's check (2.4, 2.6) | Done, on `main` | Nothing |

### Second pass, 2026-10-10. The export dialog, the email panels and the new-review form

Evidence is the live record, read without changing it. It holds 99 exports and 551 audit-log rows from 2026-09-08 on, nearly all from testing.

| What | Count |
|---|---|
| Word redline exports | 34 (31 clean, 3 partial, 0 fell back to the PDF) |
| Memo exports | 39 |
| PDF exports, marked-up and proposed | 26 |
| Clean Word copies | 8 |
| Client emails drafted, then edited | 8, 2 |
| Property emails drafted, then edited | 8, 2 |
| AI-use check stopped a review, and was then answered | 8, 8 |

**2.8 The export dialog is sound.**

- Three rows cover five files, and every one of the five has been used.
- A file that isn't clean is held out of the zip and shown with its reasons, so the associate decides on it alone. That is the right shape.
- One gap is already logged as finding 1.10. When the engine crashes, the row shows an error and offers no PDF. It belongs to piece 5.
- With blanks and amounts now settled on the card, a partial verdict should be rarer. Count them during the beta.

**2.9 The two email panels are the same screen written twice, and I would leave them.**

- About 150 of each panel's 180 lines match once the audience's name is set aside.
- The split that matters is on the server. Each audience has its own route and its own assembly, and the property's has an allowlist.
- One shared panel would save about 150 lines. A mistake there could put CD's reasoning in front of a hotel, which is the worst outcome this app has.
- No work. The saving is small and the downside is not.

**2.10 The new-review form is sound.**

- It asks for the file, new or continuing, the property name, the hotel brand, and an optional client name.
- The line under each filled field shows the contract wording it came from, which supports the decision the field asks for.

**2.11 The AI-use check is sound.**

- It stops the review before anything is sent, shows the wording it found, and asks for one of two answers.

**Not covered here.** The dashboard and the admin screens. The Standards screen is in piece 7.

**Result of the second pass.** No new fix is proposed. Piece 2 is finished apart from the two fixes already listed and waiting, 2.4 and 2.5.

## Piece 5. Exports

Audited 2026-10-10 on `audit/pieces-2-and-5`. It covers the five export files, the zip, and what each failure tells the associate. The two emails are in piece 2.

### Evidence

- The code under `lib/exports/` (1,334 lines) and the export dialog.
- The live record, read without changing it. 99 exports and their audit-log rows.

| From the record | Count |
|---|---|
| Word redlines, by result | 32 clean, 4 partial, 0 fell back |
| Marked-up PDFs drawn from the redline, and from the older overlay | 6, 1 (the rest predate the label) |
| A PDF that failed its own read-back check | 0 |
| Reviews by upload type | 29 Word, 8 PDF, 1 older Word (.doc) |

### Findings

**5.1 An engine crash shows an error, offers no PDF, and leaves no record.**

- When the engine fails a check, the associate sees "The Word file could not be produced safely" with a button for the marked-up PDF, and the export record gains a row marked as a fallback.
- When the engine crashes, the row shows a bare error. No PDF is offered, and nothing is written to the record.
- The marked-up PDF itself survives a crash. It falls back to the older overlay, which doesn't need the engine. The associate just isn't pointed at it.
- The crash fixed on 2026-10-08 would have left no trace. The fallback rate the roadmap watches (1.5%) can't see a crash.
- Proposed fix, free and small. A crash is treated as a fallback. The associate gets the same screen with the PDF button, and the record gains a fallback row with the crash's message.
- **Built and merged to `main` on 2026-10-10.** A crash returns the fallback verdict, and the real request writes one fallback row with the crash's message. A preflight writes nothing. The clean Word copy's route refuses without recording the crash a second time, and says the PDF is still available. Covered by tests on an in-memory database, with a file that is not a Word file. The screen itself can't be reached in the browser without a broken file.

**5.2 The clean Word copy can lack a change and say nothing.**

- The redline and the clean PDF are both checked before download. When a change was left out, the dialog lists it, and the clean PDF also lists it after the contract.
- The clean Word copy has no check before download. When the redline left a change out, the copy lacks it too, and neither the screen nor the file says so.
- An associate who picks only the clean Word copy could send a proposed contract that is missing an accepted change.
- How often. 4 of 36 redlines in the record were partial, and the clean Word copy has been exported 8 times.
- Proposed fix, free and small. The clean Word copy gets the redline's check before download, and the dialog lists what the copy lacks, with "Download anyway".
- Finding 2.4 would move this to the card. Until then the dialog is where the redline already says it.
- **Built and merged to `main` on 2026-10-10.** The clean Word copy answers a preflight with the redline's verdict, and the dialog lists what the copy lacks. A copy built from a widened change also asks for a look, as the redline does. Seen in the dev browser on `98d84aa5`, where the dialog read "2 changes applied. 1 could not be." and named the cutoff-date change. Nothing was downloaded, so nothing was written.

**5.3 The export record can't tell a clean Word copy from a redline.**

- Both are saved with the format `docx`. The fallback rate divides by all of them, and a clean copy can never fall back.
- Proposed fix. A format of its own for the clean copy. The database lists the allowed formats, so it needs a migration.
- Priority is low. The audit log already tells the two apart.

**5.4 Two ways of drawing a PDF exist, and both are needed.**

- A Word upload's PDFs are drawn from the redline file. A PDF or .doc upload has no Word file to mark up, so its PDFs are drawn over the original pages.
- The overlay is also the net under a redline that fails. Nine of the 38 reviews were PDF or .doc uploads.
- No change.

**5.5 Read and found sound.**

- The zip skips a file that couldn't be made and puts the reason in a note inside the archive.
- Only the redline is kept as "what we sent", which is what the next round compares against.
- A preflight writes nothing, so checking a file before download doesn't count it twice.
- A real contract filename with a long dash no longer breaks the download.

**5.6 Seen in the record, for piece 3.**

- Seven reviews ended as failed. Three left a row in the audit log.

### Proposed order

| # | Fix | Cost | Needs |
|---|---|---|---|
| 1 | A crash takes the PDF route and is recorded (5.1) | Done, on `main` | Nothing |
| 2 | The clean Word copy says what it lacks (5.2) | Done, on `main` | Nothing |
| 3 | A format of its own for the clean copy (5.3) | Free, one migration | Later, low priority |

## Piece 4. Reading the Word file

Audited 2026-10-10 on `audit/4-reading-the-word-file`. It covers the reader (`lib/docx/`), the checks at upload, the preview, and the steps kept from before the HTML preview.

### Evidence

- The code under `lib/docx/` (1,358 lines), `lib/docx-preview.ts`, the upload route and the review pipeline.
- Every stored Word upload, read without changing anything. Two scripts in `data/private/audit/` download each file, run the reader over it, and count what the reader did with each part of the file.

| From the store | Count |
|---|---|
| Reviews | 38 |
| Word uploads | 29 (22 on the Word route, 6 older with no route recorded, 1 sent to the PDF route) |
| Distinct Word files | 16 |
| Real contracts among them | 3 (CD's Ideal Standard, the redacted Florida contract in two forms, the redacted Rome contract) |
| Files with a deleted paragraph break | 0 |
| Files with a footnote, a simple field, a smart tag or a legacy checkbox | 0 |
| Upload checks that have ever failed | 1 of 7 (`text_volume`, once) |

Three real contracts is a small sample. Every finding below that rests on one file says so.

### Findings

**4.1 Clause numbers don't reach the model or the preview on the Florida contract.**

- The copy saved by Word (`c7148b08`) numbers its 30 headings through a list style. The numbering file points from the list to the style and from the style to the definition. The reader doesn't follow that link, so all 46 numbered paragraphs read "- GENERAL INFORMATION" where Word shows "1. GENERAL INFORMATION".
- The Pages export of the same contract (`2ffd7890`) numbers its 30 headings through the paragraph style. The reader looks only at the paragraph itself, so those headings carry no number at all.
- A second fault sits behind the first. The reader keeps one counter per list instance. Word keeps one counter per list and lets an instance restart it at a stated number. The Florida file restarts at 2, 3, 8, 16, 17, 20 and 25, and each of those is the right clause number only under Word's rule. Fixing the link alone would give 1, 1, 1, 2, 3.
- A third fault adds a dash where Word shows nothing. A paragraph marked "no number", or a list level whose marker is empty, reads "- ". It happens 11 times in the Pages export and 11 times in CD's Ideal Standard.
- What it costs. The model can't cite a clause by number, the associate's preview doesn't match the contract in Word, and the outline that tells two copies of the same wording apart has no sections to work with. Rome and the Ideal Standard number their clauses directly and read correctly.
- Proposed fix, free. The numbering resolver follows the list-style link, reads numbering from the paragraph style, counts per list with restarts honoured, and writes no marker where Word shows none.
- Risk is low for the redline. List numbers are markers the reader adds, and the engine never edits them. It changes the text the model reads on files that use these forms, so the proof is a before-and-after of every stored file's text, and the Florida numbers checked by the user against the contract.
- Rests on one contract in two forms. List styles are common in legal templates, so it will recur.
- **Built and merged to `main` on 2026-10-10, with 4.4** (`audit/4-1-clause-numbers`). The user checked Florida's 30 clause numbers against the contract and they match.
  - The numbering resolver follows a list to its list style, reads numbering from the paragraph's style, keeps one count per list with restarts honoured, and uses a level an instance replaces.
  - No marker is written where Word shows none. A bullet stored as a symbol-font glyph reads "•".
  - A numbered heading reads "# 1. GENERAL INFORMATION", and the preview and both PDFs draw it as a heading with its number.
  - The resolver takes the numbering part and the styles part together. The compiler flagged every caller, so the reader, the redline engine and the placement route number a file the same way.
  - **Both Florida files now give the same 30 clauses, 1 to 30.** They store the numbering two different ways, so each confirms the other.
  - Lint, the type check and 1,731 tests pass. 14 of the tests are new and built from made-up XML.
  - Before and after on all 16 stored files. No character that came from a file changed. Seven files changed in the markers the reader adds (Florida in three copies, Rome in three, the Ideal Standard), and nine are identical.
  - The replay compared 736 changes across 25 reviews, verdict by verdict. None differs, 606 are placed on each side, and the place saved on Rome on 2026-10-10 holds.
  - Seen in the dev browser on `c7148b08` (Florida) and `65f10383` (Rome).
  - Rome's 30 numbered clause titles sit in a heading style, so they now draw as headings. Their numbers are unchanged.
  - Two rules were added while building, both taken from Word's own outline. An empty paragraph in a heading style marks no heading, and neither does a heading style inside a table cell.

**4.2 Wording in a text box is never read.**

- Rome holds one text box with 264 characters, the billing choices: "Check all that may apply", "Room, tax, and incidentals to Master", "Room and tax to Master, individuals pay incidentals", "Direct bill for organized function(s) Individuals pay own", "Staff & VIPs to Master".
- The model never saw it and the preview doesn't show it. Nothing on the screen says so. The redline keeps the box, since the file itself is untouched.
- The cause is general. The reader walks the elements it knows and skips any other. A text box, a simple field, a smart tag and a custom-XML wrapper all drop their wording without a trace. Footnotes and endnotes are never opened. Only the text box appears in the stored files.
- The upload check named `map_coverage` reads as if it would catch this. It compares two lists the reader builds together, so it can never fail.
- Proposed fix, free. The reader reads a text box's wording as paragraphs after the paragraph that anchors it, and reads through wrappers it doesn't know. All of it is locked against edits to start with. Whatever wording is still unread is counted at upload and noted on the review, the way an unread picture is today.
- Risk is medium. It adds runs to the reader's map, which the engine and its oracle share. The lock keeps the engine out. The replay must place the same 605 changes.
- Rests on one contract. Whether a box is ticked is a drawn shape in that file, and no reader could tell.
- **Built and merged to `main` on 2026-10-10** (`audit/4-2-text-boxes`, user's yes).
  - The reader takes one copy of each text box and reads its paragraphs after the paragraph that anchors it, in the same table cell when the anchor sits in one.
  - It reads through a simple field, a smart tag, custom XML, the text-direction wrappers, and a table row or cell wrapped in a content control.
  - **A change to wording in a text box is refused, with its own reason** (`in_unedited_part`). The card says "The wording sits in a text box, which the redline doesn't change." and offers Edit and the email to the property. Word stores most boxes twice, and a change written to one copy could show a hotel the old wording. Lifting the lock needs a made-up file checked in two viewers.
  - **Wording still unread is counted at upload and noted on the review**, footnotes and endnotes included. The count is kept beside `pictures` on the upload's health record and never changes the route. The model is told nothing new.
  - The table check counts a text box's table once. Before, a box holding a table would have sent the file down the PDF route.
  - Lint, the type check and 1,747 tests pass. 16 are new and built from made-up XML.
  - Before and after on all 16 stored files. No wording was removed or changed. The three Rome copies each gain 264 characters, the billing choices and two footer lines. One footer line names the brand, "HILTON – CONFERENCE DIRECT CE AGREEMENT - EMEA". The Ideal Standard gains two blank paragraphs from two empty boxes. Twelve files are identical.
  - Every stored file keeps its route, and none has wording left unread.
  - The replay compared 736 changes across 25 reviews. None differs, 606 are placed on each side, and the place saved on Rome holds.
  - Seen in the dev browser on `65f10383`. The billing choices sit under "Payment Breakdown".
  - **Two departures from the plan.** The stored block kind is the existing locked one, since the database lists the allowed kinds and a new one would need a migration. The text box is told apart by its reason and its sentence. And the Ideal Standard changes by two blank paragraphs, where the plan expected 13 identical files.
  - No stored review gains a note. The count is taken at upload.

**4.3 A short contract with a large picture is sent down the PDF route.**

- The `text_volume` check divides the characters read by the size of the whole file and fails under 3 per kilobyte. A 2,000-character addendum fails as soon as the file passes 667 KB, which one logo or one scanned signature page does.
- A failed check costs the associate the Word redline, the tables and the HTML preview, and the review reads flattened text. The message blames scanned pages.
- It has fired once, on a made-up 12 MB test file with 571 characters of real text.
- Proposed fix, free and small. Measure the text against the size of the document's own XML, which pictures don't inflate. The floor of 200 characters stays.
- Risk is low. A file of scanned pages still fails, since its XML holds almost no text either.
- **Built 2026-10-10 on `audit/4-small-fixes`, not merged.**
  - The check divides the characters read by the size of the XML the reader walks. The floor of 200 characters and the threshold of 3 per KB are unchanged.
  - On the 16 stored files the new measure runs from 63 to 804 per KB. The made-up 12 MB test file moves from the PDF route to the Word route, and the other 15 keep theirs.
  - **The risk line above was too strong.** A scan with a typed cover page of over 200 characters failed the old check and passes the new one. It stays on the Word route, where each scanned page is noted as a picture and the first four go to the model as images. The user was told this in the plan.

**4.4 Headings are recognised by the style's code name, and CD's own contract uses another.**

- The reader treats a paragraph as a heading when its style is called `Heading1` to `Heading6`. CD's Ideal Standard uses `Heading1AA`, `Heading2AA` and so on, so none of its 14 headings is marked. The Word-saved Florida copy misses 4 more.
- Word itself decides by the style's outline level, which both files set correctly.
- What it costs. The preview shows those headings as body text, and the outline loses them.
- Proposed fix, free and small. Read the outline level from the style, following the style it is based on. Goes with 4.1, since both read `styles.xml`.
- **Built and merged to `main` on 2026-10-10, with 4.1.** The Ideal Standard gains 10 headings and the Word-saved Florida copy gains its four lettered sub-headings. Three of the Ideal Standard's ten are styles used for layout ("OR", "Hotel Chain Name", "Sit-down or Plated Meal"). Word treats them as headings too.

**4.5 A paragraph whose break is deleted still reads as its own paragraph.** The known lead.

- When a tracked change deletes a paragraph break, Word shows the two paragraphs as one once accepted. The reader always ends the paragraph and numbers the next one.
- On `sample-across-paragraphs-redline.docx` the accepted reading shows clause 2 followed by two empty paragraphs. Had the struck paragraphs been numbered by Word, each would leave a stray number and push every later number up by one.
- A sentence a hotel joined across a break reads as two halves. A quote across the join is refused, and the card says the change has no place.
- No stored file holds one. The app's own redlines have written them since 2026-10-09, so a hotel that returns a round-one redline with the changes left in will send one back.
- Proposed fix, free. The reader joins the paragraphs in the accepted reading and keeps them apart in the original reading. A paragraph break inserted by a tracked change gets the mirror treatment.
- Risk is real. Paragraph endings are how the preview finds its blocks and how the engine finds paragraph edges, and the oracle reads both views. It needs its own plan and the replay.
- Priority is below 4.1 and 4.2. Those are wrong on real contracts today. This one waits for the first round two.

**4.6 A Word review still writes page numbers nothing shows.**

- Every Word upload is still turned into a text-only PDF with its line positions. That stays. It is the net under an export that falls back, and it is what a file that fails the upload checks is read from.
- After each review the pipeline finds each finding's page in that PDF and writes it, one database write per finding. On the Word route no screen shows the page. 525 of 794 Word-route findings carry one.
- Proposed fix, free and small. Skip the step on the Word route.
- **Built 2026-10-10 on `audit/4-small-fixes`, not merged.** A Word-route review writes no page number and never fetches the converted PDF. A review that reads the PDF does both as before. Page numbers already stored are left.

**4.7 If the Word file can't be read at review time, the review quietly reads the PDF.**

- The reader ran on the same bytes at upload, so a failure here means storage didn't hand the file over.
- The review then reads the flattened PDF, costs the same, and looks normal. The screen still shows the Word preview, and each card checks quotes taken from other text. Nothing is recorded but a server log line.
- Proposed fix, free and small. Try the download three times, then fail the review with a plain message before the model is called. The standards loader has worked this way since 2026-10-08.
- No known case. None could be known, since nothing records it.
- **Built 2026-10-10 on `audit/4-small-fixes`, not merged.**
  - `readOriginalDocx` in `lib/read-original.ts` reads the Word file with three tries. After the third the review fails with "The Word file couldn't be read, so nothing was reviewed. Use Retry to run it again."
  - The failure comes before the model is called and before the monthly allowance counts the review. It takes the pipeline's usual failure path, so it leaves an audit row.
  - A file that arrives and isn't a Word file fails the review with the reader's reason, with no retry.
  - It rests on tests. Storage can't be broken from the browser.

**4.8 Two of the seven upload checks can never fail.**

- `map_coverage` is covered in 4.2. `revision_integrity` counts opening and closing tags, and the XML has already passed a strict parse by then.
- Proposed fix. 4.2 replaces the first with a real count of unread wording. The second goes in piece 6.
- **2026-10-10.** The count of unread wording is built with 4.2. Both dead checks are left for piece 6.

**4.9 A paragraph that opens with a line or page break draws an empty table in the preview.**

- 5 of the 16 files, once or twice each. It shows as a small gap. Offsets and highlights are unaffected.
- Proposed fix, free and tiny. The preview takes a table to start only where a row follows.
- **Built 2026-10-10 on `audit/4-small-fixes`, not merged.** No stored file's preview holds an empty table now. Seen in the dev browser on `a70ff3c5`, which shows 3 tables and none empty.

**4.10 Read and found sound.**

- The reader's text and its map are built in one pass and can't drift apart.
- A change inside a change is read into the right view (the invariant from the nested-revisions bug holds).
- The preview shows every character the reader produced, in order, on all 16 files. The scan checks this.
- Headers and footers are read as parts of their own, and comments are read beside the text and never into it.
- Field results and content controls are read and locked.
- The spaces inside Rome's figures ("€7 50.00") are in the file as uploaded. The reader adds none.

**Not covered here.** The .doc and PDF readers, which nine of 38 reviews used. The clean copy's accept step, covered in pieces 1 and 5.

### Proposed order

| # | Fix | Cost | Needs |
|---|---|---|---|
| 1 | Clause numbers and headings (4.1, 4.4) | Done, on `main` | Nothing |
| 2 | Text boxes and unread wording (4.2, 4.8) | Done, on `main` | Nothing |
| 3 | The size check (4.3) | Built, not merged | The user's yes |
| 4 | Fail loudly when the Word file can't be read (4.7) | Built, not merged | The user's yes |
| 5 | Skip the page-number step on the Word route (4.6), and the empty table (4.9) | Built, not merged | The user's yes |
| 6 | Deleted paragraph breaks (4.5) | Free | Its own plan, after the first round two or sooner if the user prefers |

**Proof for fixes 3 to 5, 2026-10-10.** Lint, the type check and 1,761 tests pass, 14 of them new. The reader's text is identical on all 16 stored files, and the replay matches on all 736 changes.

Fixes 1 and 2 change the contract text the model reads on files that use those forms. A before-and-after of each stored file's text shows which files change, at no cost. A paid review of a changed contract would need a quoted price and a yes.
