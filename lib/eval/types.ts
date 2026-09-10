import type { Severity } from "../standards/types";
import type { AnalysisResult } from "../anthropic";

/**
 * Types for the eval harness (MASTER_PLAN.md §2.0.1).
 *
 * Three things travel through this module. An ANSWER KEY says what a correct
 * review of each contract looks like. A RUN RECORD is what the pipeline
 * actually produced. A SCORE REPORT is the comparison, and it carries the
 * individual pairing decisions alongside the rates, because a rate nobody can
 * check against the pairings behind it is the failure this section exists to
 * prevent.
 *
 * Nothing here names a particular answer key. The synthetic key is data loaded
 * at the edge; swapping CD's real key in changes a file, not this file.
 */

// ---------------------------------------------------------------------------
// Answer key
// ---------------------------------------------------------------------------

/** A present clause the review must flag, or one that is absent and must be added. */
export type KeyItemKind = "present" | "absent";

/** Half-open range into an extracted part's text, matching §1.4's convention. */
export interface AnchorSpan {
  part: string;
  start: number;
  end: number;
}

export type NumericUnit = "pct" | "usd" | "days" | "months" | "hours" | "rooms";
export type Comparator = "lte" | "lt" | "eq" | "gte" | "gt";

/**
 * A checkable claim about proposed_language.
 *
 * Proposed language cannot be compared to a reference string — two correct
 * rewrites of the same clause share almost no wording. What can be checked is
 * whether the replacement actually moves the term, so the key asserts
 * properties rather than text.
 */
export type LanguageAssertion =
  | { kind: "contains_phrase"; phrase: string }
  | { kind: "absent_phrase"; phrase: string }
  | { kind: "numeric_bound"; label: string; unit: NumericUnit; comparator: Comparator; value: number };

/**
 * What the key expects of exposure_amount.
 *
 * Three modes rather than a boolean, because "the contract does not support a
 * figure" and "the key takes no view" are different claims, and only the first
 * makes a number a prompt violation. Most clauses are "unspecified" — asserting
 * a dollar figure the key cannot derive unambiguously would grade the key's
 * arithmetic rather than the model's.
 */
export type ExposureMode =
  /** The contract carries the figures, so a number within tolerance is expected. */
  | "required"
  /** The contract carries no figures here, so any number was invented. */
  | "forbidden"
  /** The key takes no position. Always grades not_applicable. */
  | "unspecified";

export interface ExposureExpectation {
  mode: ExposureMode;
  /** The figure, when mode is "required". */
  amount?: number;
  /** Fractional tolerance on that figure, e.g. 0.25 for ±25%. */
  tolerance?: number;
}

export interface KeyItem {
  id: string;
  contract: string;
  kind: KeyItemKind;
  clause_type: string;
  severity: Severity;
  /**
   * Every place the offending wording sits. Empty when the clause is absent.
   *
   * A list rather than one span because contracts restate terms — a
   * cancellation percentage appears in the prose and again in the schedule
   * table — and a finding quoting either one is pointing at the same issue.
   * With a single anchor the second quote overlaps nothing, and a correct
   * finding is scored as a miss plus a false positive.
   */
  anchors: AnchorSpan[];
  /** The wording itself, so a human can audit the key without opening the DOCX. */
  anchor_texts: string[];
  expected_language: LanguageAssertion[];
  exposure: ExposureExpectation;
  /** Why this is ground truth, in plain language. Read by humans, never by code. */
  rationale: string;
}

export interface AnswerKeyContract {
  /** File name under the corpus directory, e.g. "eval-01-harborview.docx". */
  contract: string;
  /**
   * Whether the key lists every finding a correct review would produce.
   *
   * True for a synthetic key, whose contracts were generated from a spec that
   * enumerates their own defects — so a finding matching nothing is wrong.
   * False for a key built by a reviewer working through real contracts, who
   * was never asked to be exhaustive — so a finding matching nothing there is
   * unjudged, not incorrect. This one flag is what lets the same scorer read
   * both.
   */
  exhaustive: boolean;
  items: KeyItem[];
}

export interface AnswerKey {
  version: string;
  source: "synthetic" | "cd_review";
  /** The standards library the key was derived against. */
  standards_version: string;
  generated_at: string;
  contracts: AnswerKeyContract[];
}

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export interface RunDocument {
  contract: string;
  analysis: AnalysisResult | null;
  /** Set when the analysis failed; `analysis` is null in that case. */
  error: string | null;
  elapsed_ms: number;
}

export interface RunRecord {
  run_id: string;
  created_at: string;
  model_id: string;
  standards_version: string;
  standards_hash: string;
  documents: RunDocument[];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Which evidence paired a finding with a key item.
 *
 * "span" means both sides named a place in the document and those places
 * overlap. "clause_type" is the weaker fallback, used only where one side has
 * no location to give — a missing-clause finding quotes nothing, and a quote
 * that appears several times resolves nowhere.
 */
export type MatchBasis = "span" | "clause_type";

export type LocationStatus =
  /** Found in the document. */
  | { status: "located"; span: AnchorSpan; resolution: "exact" | "normalized" | "fuzzy" }
  /** The wording is not in the document. The model wrote a quote no one can check. */
  | { status: "unlocatable"; reason: string }
  /** The wording appears several times and location_section does not separate them. */
  | { status: "ambiguous"; reason: string }
  /** The finding quotes nothing, which is correct for a missing clause. */
  | { status: "no_quote" };

export type FindingOutcome =
  | "matched"
  /** Overlaps a key item another finding already took — one issue split in two. */
  | "duplicate"
  /** Matches nothing, and the key claims to be exhaustive. */
  | "spurious"
  /** Matches nothing, and the key does not claim to be exhaustive. */
  | "unscored";

export type Verdict = "correct" | "wrong";
export type SeverityVerdict = "exact" | "over_called" | "under_called";
export type ExposureVerdict =
  | "correct"
  | "omitted"
  /** A figure the contract does not support. The system prompt forbids this outright. */
  | "invented"
  | "out_of_tolerance"
  | "not_applicable";
export type QuoteVerdict = "exact" | "normalized" | "fuzzy" | "unlocatable" | "ambiguous" | "none";

export interface LanguageCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Grade {
  clause_type: Verdict;
  presence: Verdict;
  severity: {
    verdict: SeverityVerdict;
    /** Signed steps on the high/medium/low/note scale. Positive means over-called. */
    distance: number;
  };
  quote: QuoteVerdict;
  exposure: ExposureVerdict;
  language: { passed: boolean; checks: LanguageCheck[] };
}

/** One pairing, with everything a human needs to check it by eye. */
export interface MatchedPair {
  key_item_id: string;
  finding_index: number;
  basis: MatchBasis;
  weight: number;
  /** How much of the best-overlapping anchor the finding covers. 0 on a clause-type match. */
  overlap_fraction: number;
  key_clause_type: string;
  key_severity: Severity;
  key_anchor_texts: string[];
  finding_clause_type: string;
  finding_severity: Severity;
  finding_quoted_text: string | null;
  location: LocationStatus;
  grade: Grade;
}

export interface MissedItem {
  key_item_id: string;
  clause_type: string;
  severity: Severity;
  kind: KeyItemKind;
  anchor_texts: string[];
  /**
   * Index of a matched finding whose span already covers this anchor, when
   * there is one. That is one finding standing in for two issues, which is a
   * different problem from not noticing the clause at all — it carries one
   * severity and one replacement where two were needed.
   */
  conflated_with: number | null;
}

export interface UnmatchedFinding {
  finding_index: number;
  outcome: Exclude<FindingOutcome, "matched">;
  clause_type: string;
  severity: Severity;
  quoted_text: string | null;
  location: LocationStatus;
  /** Set on a duplicate — the key item another finding already took. */
  duplicate_of: string | null;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ContractResult {
  contract: string;
  exhaustive: boolean;
  error: string | null;
  matched: MatchedPair[];
  missed: MissedItem[];
  unmatched: UnmatchedFinding[];
  /** Clause types the key expects to have been considered, and those never listed. */
  coverage: { expected: string[]; not_checked: string[] };
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_creation: number;
  };
  elapsed_ms: number;
}

export interface DetectionRates {
  key_items: number;
  matched: number;
  missed: number;
  conflated: number;
  duplicates: number;
  spurious: number;
  unscored: number;
  recall: number;
  precision: number;
  f1: number;
}

export interface SeverityBandRow {
  severity: Severity;
  key_items: number;
  matched: number;
  recall: number;
}

export interface ClauseTypeRow {
  clause_type: string;
  key_items: number;
  matched: number;
  missed: number;
  spurious: number;
  recall: number;
  clause_type_accuracy: number;
}

export interface AttributeRates {
  /** Denominator for every rate here — attributes are only gradeable on a pair. */
  graded: number;
  clause_type_correct: number;
  presence_correct: number;
  severity_exact: number;
  severity_within_one: number;
  severity_over_called: number;
  severity_under_called: number;
  language_passed: number;
  quote: Record<QuoteVerdict, number>;
  exposure: Record<ExposureVerdict, number>;
  /** Rows are the key's severity, columns the model's. */
  severity_confusion: Record<Severity, Record<Severity, number>>;
}

export interface ScoreReport {
  key_version: string;
  key_source: AnswerKey["source"];
  run_id: string;
  run_created_at: string;
  model_id: string;
  standards_version: string;
  /** Set when the run and the key were built against different standards libraries. */
  standards_mismatch: string | null;
  scored_at: string;
  detection: DetectionRates;
  by_severity: SeverityBandRow[];
  /** Recall weighted so a missed high-severity item costs more than a missed note. */
  weighted_recall: number;
  attributes: AttributeRates;
  by_clause_type: ClauseTypeRow[];
  contracts: ContractResult[];
  tokens: { input: number; output: number; cache_read: number; cache_creation: number };
}

// ---------------------------------------------------------------------------
// Shared scales
// ---------------------------------------------------------------------------

/** Most severe first, so the index is the ordinal distance the grader reports. */
export const SEVERITY_ORDER: readonly Severity[] = ["high", "medium", "low", "note"];

/** Weights for weighted recall. Missing a high-severity finding is the failure that matters. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  high: 8,
  medium: 4,
  low: 2,
  note: 1,
};

export function severityRank(severity: Severity): number {
  const at = SEVERITY_ORDER.indexOf(severity);
  if (at === -1) throw new Error(`Unknown severity: ${severity}`);
  return at;
}
