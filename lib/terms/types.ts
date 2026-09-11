import type { NumericUnit } from "../quantities";

/**
 * Types for structured term extraction (MASTER_PLAN.md §2.0.2).
 *
 * Findings say a term is unfavourable. Terms say what it is — a threshold of
 * 0.90, a cutoff 30 days out. Deadlines, the what-if calculator, savings and
 * executive summaries all compute from these values, so they share one
 * extraction rather than each reading the contract its own way.
 */

export type TermKind = "number" | "enum" | "boolean" | "date" | "schedule";

export interface TermDefinition {
  /** `<group>.<field>`, where the group is a clause type or "deal". */
  key: string;
  kind: TermKind;
  /** Number kind only. Percentages are stored as fractions, so 90% is 0.9. */
  unit?: NumericUnit;
  /** Enum kind only: each value and what it means. "other" is always accepted too. */
  options?: Record<string, string>;
  /** What the value is. For a boolean, what true and false each mean. */
  meaning: string;
}

/** The industry layer: which terms exist and how each is typed. Never a client's positions. */
export interface TermCatalog {
  version: string;
  terms: TermDefinition[];
}

/** One band of a damages schedule. Percentages are fractions. */
export interface ScheduleTier {
  /** The band as the contract words it. */
  label: string;
  /** Fewest days before arrival the band covers; 0 when it runs up to arrival. */
  days_prior_min: number;
  /** Most days before arrival it covers; null for an open-ended earliest band. */
  days_prior_max: number | null;
  pct: number;
}

export type TermValue = number | string | boolean | ScheduleTier[];

/**
 * How far a stored value was checked against the document.
 *
 * Downstream features compute only from `verified` and `located`. The other two
 * are kept so an associate can see them, never so a number can be built on them.
 */
export type Verification =
  /** The quote is in the document and contains the value. */
  | "verified"
  /** The quote is in the document; the value has no figure to check against it. */
  | "located"
  /** The quote is in the document and states a different figure. */
  | "contradicted"
  /** The quote is not in the document. */
  | "unlocated";

export const USABLE_VERIFICATIONS: readonly Verification[] = ["verified", "located"];

export type Confidence = "high" | "medium" | "low";

/** One stated value, validated and checked. */
export interface StatedTerm {
  term_key: string;
  value: TermValue;
  unit: NumericUnit | null;
  quoted_text: string;
  source_section: string | null;
  confidence: Confidence;
  verification: Verification;
}

/** An entry the model returned that could not be stored, and why. */
export interface RejectedEntry {
  term_key: string;
  reason: string;
  raw: unknown;
}

/** The whole result of one extraction pass, before storage. */
export interface ExtractedTerms {
  catalog_version: string;
  stated: StatedTerm[];
  /** Catalog keys the contract does not state. */
  not_stated: string[];
  rejected: RejectedEntry[];
  /** Keys stated more than once with different values. Every value is kept in `stated`. */
  conflicts: string[];
}
