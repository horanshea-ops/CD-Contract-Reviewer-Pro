import type { ExtractedTerms, TermValue, Verification } from "../../terms/types";

/**
 * Types for scoring term extraction (MASTER_PLAN.md §2.0.2).
 *
 * Deliberately separate from the findings harness. Findings are paired to the
 * key by where they point; terms are compared by value, key by key, because a
 * term has exactly one right answer and it is not a matter of location.
 */

export const NOT_STATED = "not_stated" as const;

/** The error a contract carries when a --only capture left it out. It is not scored. */
export const NOT_IN_RUN = "Not in the run.";

export type KeyedValue = TermValue | typeof NOT_STATED;

export interface TermsKey {
  version: string;
  /** Built from the eval specs, or written by a person reading a real contract. */
  source: "synthetic" | "hand";
  catalog_version: string;
  contracts: TermsKeyContract[];
}

export interface TermsKeyContract {
  contract: string;
  /** Each keyed term's true value, or "not_stated". A term left out is not scored. */
  terms: Record<string, KeyedValue>;
  /** Terms deliberately left unscored, and why. Read by humans. */
  unkeyed?: Record<string, string>;
}

export interface TermsRunDocument {
  contract: string;
  terms: ExtractedTerms | null;
  error: string | null;
  tokens: { input: number; output: number; cache_read: number; cache_creation: number } | null;
  elapsed_ms: number;
}

export interface TermsRunRecord {
  run_id: string;
  created_at: string;
  model_id: string;
  catalog_version: string;
  documents: TermsRunDocument[];
}

export type TermOutcome =
  /** The one value stated matches the key. */
  | "correct"
  /** One value stated, and it is not the key's. */
  | "wrong_value"
  /** Several different values stated for one term. Visible to the associate, so never silent. */
  | "conflict"
  /** The key has a value and the extraction stated none. */
  | "missed"
  /** The key says the contract does not state it, and the extraction stated a value. */
  | "invented"
  /** The key says not stated, and the extraction agreed. */
  | "correct_absent";

export interface TermResult {
  term_key: string;
  kind: string;
  expected: KeyedValue;
  got: { value: TermValue; verification: Verification; quoted_text: string }[];
  outcome: TermOutcome;
  /**
   * A wrong or invented value that still passed verification. This is the one
   * that matters: it would reach a downstream calculation with nothing marking
   * it as doubtful.
   */
  silent_wrong: boolean;
}

export interface TermsTally {
  /** Terms the key gives a value. */
  keyed_values: number;
  correct: number;
  wrong_value: number;
  conflict: number;
  missed: number;
  /** Terms the key says the contract does not state. */
  keyed_absent: number;
  correct_absent: number;
  invented: number;
  silent_wrong: number;
}

export interface TermsContractResult {
  contract: string;
  error: string | null;
  results: TermResult[];
  tally: TermsTally;
  /** Stated values for terms this key does not score. */
  unkeyed_stated: number;
  rejected: number;
  tokens: TermsRunDocument["tokens"];
}

export interface TermsScoreReport {
  key_version: string;
  key_source: TermsKey["source"];
  run_id: string;
  run_created_at: string;
  model_id: string;
  catalog_version: string;
  /** Set when the run, the key and the catalog were not all built against the same catalog version. */
  catalog_mismatch: string | null;
  scored_at: string;
  tally: TermsTally;
  by_kind: { kind: string; tally: TermsTally }[];
  /** Across every stored value in the run, keyed or not. */
  verification: Record<Verification, number>;
  contracts: TermsContractResult[];
  tokens: { input: number; output: number; cache_read: number; cache_creation: number };
}
