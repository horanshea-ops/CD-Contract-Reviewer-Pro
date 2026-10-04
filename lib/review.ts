import { skippedClausesNote } from "./analysis-review";
import { analyzeContract, type AnalyzeContractPdfArgs, type AnalyzableDocument, type CategorizedAnalysis } from "./anthropic";
import { withComputedExposures } from "./exposures/compute";
import { EXPOSURE_TERM_KEYS, NO_FIGURES, readFigures, TIER_ANSWER_KEYS, type FigureReading } from "./exposures/figures";
import { applyCategories } from "./finding-categories";
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
 * Any other clause left without a finding is named in one note.
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

/** The terms a second reading asks for. */
export const TIER_CATALOG = catalogOf(TIER_ANSWER_KEYS);

export interface ReviewContractArgs extends AnalyzeContractPdfArgs {
  /** The text the model reads, split the way the locator expects. The reader's quotes are checked against it. */
  parts: LocatablePart[];
  /** The terms the reading call asks for. It must hold the exposure terms. Defaults to those alone. */
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
  | ({ ok: true } & Reading & FigureReading & { reask: Reask | null })
  | { ok: false; error: string };

export interface ContractReview extends CategorizedAnalysis {
  reading: ReadingOutcome;
}

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
  if (read.unanswered.length === 0) return { ...first, ...read, reask: null };

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

export async function reviewContract({ parts, catalog = EXPOSURE_CATALOG, ...review }: ReviewContractArgs): Promise<ContractReview> {
  // Resolves either way, so a failed reading can never fail the review or leave a rejection unhandled.
  const pending: Promise<ReadingOutcome> = readContract({
    document: review.document,
    parts,
    catalog,
    model: review.model,
    deadline: review.deadline,
  }).then(
    (outcome) => ({ ok: true as const, ...outcome }),
    (err: unknown) => ({ ok: false as const, error: messageOf(err) })
  );

  const analysis = await analyzeContract(review);
  const reading = await pending;

  if (reading.ok) {
    if (reading.reask) {
      console.warn(`[exposures] asked the reader again for ${reading.reask.asked_for.join(", ")}${reading.reask.error ? `, and that call failed — ${reading.reask.error}` : ""}`);
    }
    for (const note of reading.notes) console.warn(`[exposures] ${note.term_key}: ${note.reason}`);
  } else {
    console.error(`reviewContract: the reading call failed, so this review carries no exposures — ${reading.error}`);
  }
  const figures = reading.ok ? reading.figures : NO_FIGURES;

  const byApp = reading.ok ? mustRaise(figures, reading.terms, analysis.findings, review.standards) : { findings: [], uncovered: [] };
  const findings = [...analysis.findings, ...applyCategories(byApp.findings, review.standards)];

  const notes = [
    skippedClausesNote(analysis.review_gaps, findings),
    ...byApp.uncovered.map((number) => ({
      headline: `${number.headline}.`,
      detail: "No finding covers this number, and the app couldn't write wording for it. Read the clause yourself.",
    })),
  ].filter((note) => note !== null);

  return {
    ...analysis,
    findings: withComputedExposures(findings, figures),
    document_notes: [...analysis.document_notes, ...notes],
    deal_figures: figures,
    reading,
  };
}
