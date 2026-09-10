import type { Comparator, ExposureMode, NumericUnit } from "../types";

/**
 * The eval corpus, as data (MASTER_PLAN.md §2.0.1).
 *
 * A spec states every negotiable term in one contract as a typed value. The
 * contract's prose is generated from the spec, and the answer key is derived
 * from the same spec, so what is true about each document is fixed before any
 * text exists. Nobody reads a contract to decide what it says.
 *
 * That is the whole reason for the layer. A key written by reading generated
 * prose would carry a human's reading errors, and would need a second human to
 * check — which is exactly the dependency §2.0.1 exists to remove.
 */

/** What a term field can hold. Deliberately narrow, because every value is checked. */
export type TermValue = number | string | boolean;

/** One clause's terms, keyed by field name. A clause the contract omits is "absent". */
export type ClauseTerms = Record<string, TermValue>;

export type SpecClause = ClauseTerms | "absent";

/**
 * One check CD's position makes against a term field.
 *
 * `label` is what the field is called in prose, and it does double duty — the
 * drafter is told to state the field under that name, and lib/eval/language.ts
 * looks for it when checking whether proposed language moved the number.
 */
export type TermCheck =
  | {
      field: string;
      label: string;
      kind: "number";
      comparator: Comparator;
      value: number;
      unit: NumericUnit;
    }
  | { field: string; label: string; kind: "enum"; allowed: string[] }
  | { field: string; label: string; kind: "boolean"; expected: boolean };

/**
 * CD's position on one clause, in machine-readable form.
 *
 * `checks` restates what `position` says in prose in lib/standards/v1.ts. The
 * restatement is deliberate — prose cannot be compared against a number — but
 * it is also a place two descriptions of the same position can drift apart, so
 * a test asserts every clause type here exists in the loaded library, and
 * severity is always read from the library rather than repeated here.
 *
 * `stated` lists fields a contract may state that carry no position. They are
 * still drafted and still anchored, because they feed exposure arithmetic and
 * because a contract that only ever mentions the terms CD objects to is not a
 * contract.
 */
export interface ClausePosition {
  clause_type: string;
  checks: TermCheck[];
  stated?: string[];
  /**
   * What a finding on this clause should say about exposure_amount. Declared
   * per clause rather than inferred, because the inference has edge cases and a
   * wrong call here grades the key rather than the model.
   */
  exposure: ExposureMode;
}

export type ContractVoice = "terse" | "verbose" | "brand_boilerplate";

export interface EvalContractSpec {
  /** Also the DOCX basename, without extension. */
  id: string;
  hotel: string;
  group: string;
  city: string;
  state: string;
  /** Event dates, as they should read in the contract. */
  dates: string;
  /** Peak night room block. */
  room_block: number;
  /** Contracted nights, used for exposure arithmetic. */
  nights: number;
  /** Group rate, USD. */
  adr: number;
  /** Contracted food and beverage minimum, USD. */
  fb_minimum: number;
  style: {
    voice: ContractVoice;
    tables: "few" | "many";
    /** Whether terms also appear in an attached exhibit. */
    exhibits: boolean;
    /** Whether a term is carried in the header or footer, as hotels routinely do. */
    header_footer_terms: boolean;
  };
  /**
   * Every clause type in the standards library, with no implicit third state —
   * a clause is either given terms or explicitly marked absent. Forcing the
   * choice is what keeps "known by construction" true, since a clause type
   * nobody decided about would be neither present nor keyed.
   */
  terms: Record<string, SpecClause>;
  /** What this contract is in the corpus to exercise. Read by humans. */
  intent: string;
}

/** A field that must appear in the drafted prose, and the sentence that states it. */
export interface DraftAnchor {
  clause_type: string;
  field: string;
  /** Verbatim substring of the drafted prose. */
  sentence: string;
}
