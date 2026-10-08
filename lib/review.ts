import { clauseKey, skippedClauses, skippedClausesNote, type ClauseReview } from "./analysis-review";
import { analyzeContract, type AnalyzeContractPdfArgs, type AnalyzableDocument, type CategorizedAnalysis } from "./anthropic";
import { positionsFrom, type PositionsRead } from "./exposures/cd-positions";
import { withComputedExposures } from "./exposures/compute";
import { exposuresEnabled } from "./exposures/enabled";
import { EXPOSURE_TERM_KEYS, MUST_RAISE_TERM_KEYS, NO_FIGURES, readFigures, TIER_ANSWER_KEYS, type FigureReading } from "./exposures/figures";
import { applyCategories, type CategorizedFinding } from "./finding-categories";
import { mustRaise } from "./must-raise";
import type { LocatablePart } from "./redline-engine/locate";
import { HOTEL_TERM_CATALOG } from "./terms/catalog";
import { extractTerms } from "./terms/extract";
import type { StatedTerm, TermCatalog } from "./terms/types";
import { validateTerms } from "./terms/validate";

/**
 * One review of a contract, as two model calls run side by side.
 *
 * The judging call compares each clause with the standards and writes the
 * findings. The reading call records the terms the contract states, each
 * checked against the contract's own words. The dollar exposures are worked
 * out from those checked terms, so the contract's numbers are read once, by
 * one reader, whatever else uses them.
 *
 * Whether a clause gets a finding is the judging call's choice, and it can
 * judge a clause short and write nothing. For the numbers CD always raises,
 * the app writes the finding itself from the checked terms (lib/must-raise.ts).
 * For any other clause left without a finding, the judging call is asked once
 * more, for those clauses alone. A clause still uncovered is named in one note.
 *
 * The reader's answers vary from run to run. When a reading has cancellation
 * terms in it and leaves out an answer the cancellation figure needs, the
 * reader is asked once more for those answers alone.
 */

const catalogOf = (keys: readonly string[]): TermCatalog => ({
  version: HOTEL_TERM_CATALOG.version,
  terms: HOTEL_TERM_CATALOG.terms.filter((term) => keys.includes(term.key)),
});

/** The terms the figures are read from. A reading pass asks for these when it has no wider catalog to read. */
export const EXPOSURE_CATALOG = catalogOf(EXPOSURE_TERM_KEYS);

/** The terms the app's own findings need. A reading pass asks for these alone while exposure math is archived. */
export const MUST_RAISE_CATALOG = catalogOf(MUST_RAISE_TERM_KEYS);

/** The terms a second reading asks for. */
export const TIER_CATALOG = catalogOf(TIER_ANSWER_KEYS);

export interface ReviewContractArgs extends AnalyzeContractPdfArgs {
  /** The text the model reads, split the way the locator expects. The reader's quotes are checked against it. */
  parts: LocatablePart[];
  /**
   * The terms the reading call asks for. Defaults to the exposure terms, or to
   * the must-raise terms alone while exposure math is archived.
   */
  catalog?: TermCatalog;
}

type Reading = Awaited<ReturnType<typeof extractTerms>>;

/** A second reading, made when the first left out an answer the cancellation figure needs. */
export interface Reask {
  asked_for: string[];
  /** What the first reading gave for those terms. The second reading's answers stand in their place. */
  replaced: StatedTerm[];
  /** The second reading's own usage. The reading's total counts it too. */
  tokens?: Reading["tokens"];
  error?: string;
}

/** The reading call's result with the figures taken from it, or why there isn't one. */
export type ReadingOutcome =
  | ({ ok: true } & Reading & FigureReading & { reask: Reask | null; positions: PositionsRead })
  | { ok: false; error: string };

/** A second ask of the judging call, for clauses it judged short and left without a finding. */
export interface FollowUp {
  asked_for: string[];
  /** Findings the second ask wrote on those clauses. */
  findings_added: number;
  tokens?: Reading["tokens"];
  /** Why the second ask gave nothing: it failed, or too little time was left to make it. */
  error?: string;
}

export interface ContractReview extends CategorizedAnalysis {
  reading: ReadingOutcome;
  /** Null when the judging call left no clause to ask about. */
  follow_up: FollowUp | null;
}

/** A second ask needs about this long. With less left, the note names the clauses. */
const ASK_AGAIN_MIN_MS = 90_000;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const keyOf = (entry: unknown) => String((entry as { term_key?: unknown } | null)?.term_key ?? "").trim();

interface ReadArgs {
  document: AnalyzableDocument;
  parts: LocatablePart[];
  catalog: TermCatalog;
  model?: string;
  deadline?: number;
}

async function readContract(args: ReadArgs): Promise<Reading & FigureReading & { reask: Reask | null }> {
  const first = await extractTerms(args);
  const read = readFigures(first.terms);
  // The second ask serves the cancellation figure alone, so it waits with the exposures.
  if (read.unanswered.length === 0 || !exposuresEnabled()) return { ...first, ...read, reask: null };

  const asked_for = read.unanswered;
  const replaced = first.terms.stated.filter((t) => asked_for.includes(t.term_key));
  try {
    const second = await extractTerms({ ...args, catalog: TIER_CATALOG });

    // Both readings are checked as one. An answer both gave must agree, or the
    // term counts as read with two values and gives no figure. The first
    // reading's unusable answers are set aside, so they can't clash with the
    // answers that replace them.
    const entries = [...first.entries.filter((entry) => !asked_for.includes(keyOf(entry))), ...second.entries];
    const terms = validateTerms(entries, args.catalog, args.parts);
    const tokens = {
      input: first.tokens.input + second.tokens.input,
      output: first.tokens.output + second.tokens.output,
      cache_read: first.tokens.cache_read + second.tokens.cache_read,
      cache_creation: first.tokens.cache_creation + second.tokens.cache_creation,
    };
    return { entries, terms, model_id: first.model_id, tokens, ...readFigures(terms), reask: { asked_for, replaced, tokens: second.tokens } };
  } catch (err) {
    return { ...first, ...read, reask: { asked_for, replaced, error: messageOf(err) } };
  }
}

/** What the second ask is told about the first pass. */
export function askAgainNote(skipped: ClauseReview[]): string {
  const verdicts = skipped.map((entry) => `- ${entry.clause_type}: ${entry.verdict}. ${entry.basis}`).join("\n");
  return (
    `EARLIER PASS:\n\nAn earlier pass of this review gave the clause types below these verdicts and recorded no finding for them. ` +
    `The verdicts stand. Record the findings for these clause types now. ` +
    `Record nothing else: leave other_findings and document_notes empty.\n\n${verdicts}`
  );
}

/**
 * Asks the judging call once more, with a library cut down to the clause types
 * it judged short and left without a finding. Never throws, so a failed second
 * ask leaves the review as the first pass made it.
 */
async function askAgain(review: AnalyzeContractPdfArgs, skipped: ClauseReview[]): Promise<{ findings: CategorizedFinding[]; record: FollowUp }> {
  const asked = new Set(skipped.map((entry) => clauseKey(entry.clause_type)));
  const asked_for = skipped.map((entry) => entry.clause_type);

  try {
    const second = await analyzeContract({
      ...review,
      standards: review.standards.filter((standard) => asked.has(clauseKey(standard.clause_type))),
      contextNote: [review.contextNote, askAgainNote(skipped)].filter(Boolean).join("\n\n"),
    });

    // Anything else the second pass wrote would repeat the first.
    const findings = second.findings.filter((finding) => finding.category !== "other" && asked.has(clauseKey(finding.clause_type)));
    return {
      findings,
      record: {
        asked_for,
        findings_added: findings.length,
        tokens: {
          input: second.input_tokens,
          output: second.output_tokens,
          cache_read: second.cache_read_input_tokens,
          cache_creation: second.cache_creation_input_tokens,
        },
      },
    };
  } catch (err) {
    return { findings: [], record: { asked_for, findings_added: 0, error: messageOf(err) } };
  }
}

export async function reviewContract({ parts, catalog, ...review }: ReviewContractArgs): Promise<ContractReview> {
  const exposures = exposuresEnabled();

  // CD's numbers, as the library states them today. Kept with the reading, so a review records what it was measured against.
  const cd = positionsFrom(review.standards);
  if (cd.unread.length > 0) {
    console.warn(`[exposures] the standards library's wording doesn't state ${cd.unread.join(", ")}, so the built-in value is used`);
  }

  // Resolves either way, so a failed reading can never fail the review or leave a rejection unhandled.
  const pending: Promise<ReadingOutcome> = readContract({
    document: review.document,
    parts,
    catalog: catalog ?? (exposures ? EXPOSURE_CATALOG : MUST_RAISE_CATALOG),
    model: review.model,
    deadline: review.deadline,
  }).then(
    (outcome) => ({ ok: true as const, ...outcome, positions: cd }),
    (err: unknown) => ({ ok: false as const, error: messageOf(err) })
  );

  const analysis = await analyzeContract(review);
  const reading = await pending;

  if (reading.ok) {
    if (reading.reask) {
      console.warn(`[exposures] asked the reader again for ${reading.reask.asked_for.join(", ")}${reading.reask.error ? `, and that call failed — ${reading.reask.error}` : ""}`);
    }
    if (exposures) for (const note of reading.notes) console.warn(`[exposures] ${note.term_key}: ${note.reason}`);
  } else {
    console.error(`reviewContract: the reading call failed, so this review has no figures and no findings of the app's own — ${reading.error}`);
  }
  const figures = reading.ok ? reading.figures : NO_FIGURES;

  const byApp = reading.ok ? mustRaise(figures, reading.terms, analysis.findings, review.standards, cd.positions) : { findings: [], uncovered: [] };
  const firstPass = [...analysis.findings, ...applyCategories(byApp.findings, review.standards)];

  const skipped = skippedClauses(analysis.review_gaps, firstPass).flatMap(
    (clauseType) => analysis.clause_review.find((entry) => clauseKey(entry.clause_type) === clauseKey(clauseType)) ?? []
  );
  const timeLeft = review.deadline === undefined ? Infinity : review.deadline - Date.now();
  const asked =
    skipped.length === 0
      ? null
      : timeLeft >= ASK_AGAIN_MIN_MS
        ? await askAgain(review, skipped)
        : { findings: [], record: { asked_for: skipped.map((entry) => entry.clause_type), findings_added: 0, error: "Too little time was left to ask again." } };
  if (asked) {
    const { asked_for, findings_added, error } = asked.record;
    console.warn(`reviewContract: asked again for ${asked_for.join(", ")}, and ${error ? `got nothing — ${error}` : `${findings_added === 1 ? "1 finding" : `${findings_added} findings`} came back`}`);
  }
  const findings = [...firstPass, ...(asked?.findings ?? [])];

  const notes = [
    skippedClausesNote(analysis.review_gaps, findings),
    ...byApp.uncovered.map((number) => ({
      headline: `${number.headline}.`,
      detail: "No finding covers this number, and the app couldn't write wording for it. Read the clause yourself.",
    })),
  ].filter((note) => note !== null);

  return {
    ...analysis,
    // The figures still feed the findings the app raises. They become dollar amounts only with EXPOSURES on.
    findings: withComputedExposures(findings, exposures ? figures : NO_FIGURES, cd.positions),
    document_notes: [...analysis.document_notes, ...notes],
    deal_figures: figures,
    reading,
    follow_up: asked?.record ?? null,
  };
}
