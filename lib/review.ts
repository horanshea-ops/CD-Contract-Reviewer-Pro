import { analyzeContract, type AnalyzeContractPdfArgs, type CategorizedAnalysis } from "./anthropic";
import { withComputedExposures } from "./exposures/compute";
import { EXPOSURE_TERM_KEYS, NO_FIGURES, readFigures, type FigureReading } from "./exposures/figures";
import type { LocatablePart } from "./redline-engine/locate";
import { HOTEL_TERM_CATALOG } from "./terms/catalog";
import { extractTerms } from "./terms/extract";
import type { TermCatalog } from "./terms/types";

/**
 * One review of a contract, as two model calls run side by side.
 *
 * The judging call compares each clause with the standards and writes the
 * findings. The reading call records the terms the contract states, each
 * checked against the contract's own words. The dollar exposures are worked
 * out from those checked terms, so the contract's numbers are read once, by
 * one reader, whatever else uses them.
 */

/** The terms exposures are worked out from. A reading pass asks for these when it has no wider catalog to read. */
export const EXPOSURE_CATALOG: TermCatalog = {
  version: HOTEL_TERM_CATALOG.version,
  terms: HOTEL_TERM_CATALOG.terms.filter((term) => EXPOSURE_TERM_KEYS.includes(term.key)),
};

export interface ReviewContractArgs extends AnalyzeContractPdfArgs {
  /** The text the model reads, split the way the locator expects. The reader's quotes are checked against it. */
  parts: LocatablePart[];
  /** The terms the reading call asks for. It must hold the exposure terms. Defaults to those alone. */
  catalog?: TermCatalog;
}

/** The reading call's result with the figures taken from it, or why there isn't one. */
export type ReadingOutcome =
  | ({ ok: true } & Awaited<ReturnType<typeof extractTerms>> & FigureReading)
  | { ok: false; error: string };

export interface ContractReview extends CategorizedAnalysis {
  reading: ReadingOutcome;
}

export async function reviewContract({ parts, catalog = EXPOSURE_CATALOG, ...review }: ReviewContractArgs): Promise<ContractReview> {
  // Resolves either way, so a failed reading can never fail the review or leave a rejection unhandled.
  const pending: Promise<ReadingOutcome> = extractTerms({
    document: review.document,
    parts,
    catalog,
    model: review.model,
    deadline: review.deadline,
  }).then(
    (outcome) => ({ ok: true as const, ...outcome, ...readFigures(outcome.terms) }),
    (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })
  );

  const analysis = await analyzeContract(review);
  const reading = await pending;

  if (!reading.ok) console.error(`reviewContract: the reading call failed, so this review carries no exposures — ${reading.error}`);
  const figures = reading.ok ? reading.figures : NO_FIGURES;

  return {
    ...analysis,
    findings: withComputedExposures(analysis.findings, figures),
    deal_figures: figures,
    reading,
  };
}
