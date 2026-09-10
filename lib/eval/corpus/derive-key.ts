import type { Severity, StandardEntry } from "../../standards/types";
import type { AnchorSpan, ExposureExpectation, KeyItem, KeyItemKind, LanguageAssertion } from "../types";
import type { EvalContractSpec, TermCheck, TermValue } from "./spec";
import { CD_POSITIONS, POSITION_BY_CLAUSE, clauseFields } from "./positions";

/**
 * Deriving the answer key from a contract's spec (MASTER_PLAN.md §2.0.1).
 *
 * Deterministic and model-free. A key item exists for a clause when the spec's
 * terms fail one or more of CD's checks, and severity is read from the loaded
 * standards library rather than restated here, so the key tracks the library
 * the model is actually given.
 *
 * One key item per deviating CLAUSE, not per failing check. That is the shape
 * of the output being graded — one finding carries one severity and one
 * replacement — so a clause failing three checks is one thing to notice, not
 * three. A model that files three findings there produces two duplicates, and
 * the report says so.
 */

/** Anchors are drafted per field, so a key item names the field it points at. */
export interface PendingKeyItem {
  id: string;
  contract: string;
  kind: KeyItemKind;
  clause_type: string;
  severity: Severity;
  /** The field whose drafted sentence becomes the anchor. Null when absent. */
  anchor_field: string | null;
  failed_fields: string[];
  expected_language: LanguageAssertion[];
  exposure: ExposureExpectation;
  rationale: string;
}

/**
 * Enum values rendered as the wording a contract or a replacement would use.
 *
 * Only entries listed here produce language assertions. An enum whose values
 * are contract-specific (which state governs, say) is absent on purpose —
 * asserting a phrase the key cannot predict would report an assertion failure
 * as a model failure.
 */
const ENUM_PHRASES: Record<string, Record<string, string>> = {
  basis: { cumulative: "cumulative", night_by_night: "night-by-night" },
  damages_basis: { room_profit: "room profit", gross_revenue: "gross room revenue" },
  standard: { impracticable: "impracticable", impossible: "impossible" },
};

export function checkPasses(check: TermCheck, value: TermValue): boolean {
  switch (check.kind) {
    case "number": {
      if (typeof value !== "number") return false;
      switch (check.comparator) {
        case "lte":
          return value <= check.value;
        case "lt":
          return value < check.value;
        case "eq":
          return value === check.value;
        case "gte":
          return value >= check.value;
        case "gt":
          return value > check.value;
      }
      break;
    }
    case "enum":
      return typeof value === "string" && check.allowed.includes(value);
    case "boolean":
      return value === check.expected;
  }
  return false;
}

/**
 * What a correct replacement must satisfy, for one check the contract fails.
 *
 * Numeric checks convert directly — the replacement has to state a number on
 * CD's side of the bound. Enum checks convert only where the wording is
 * predictable. **Boolean checks produce nothing**, deliberately: a clause that
 * should add a resale-credit obligation can be rewritten a dozen correct ways,
 * and no phrase list covers them. Asserting one anyway would report the
 * assertion's narrowness as the model's error, which is the silent scoring bug
 * this whole section exists to avoid.
 */
function assertionsFor(check: TermCheck, contractValue: TermValue): LanguageAssertion[] {
  if (check.kind === "number") {
    return [
      { kind: "numeric_bound", label: check.label, unit: check.unit, comparator: check.comparator, value: check.value },
    ];
  }

  if (check.kind === "enum") {
    const phrases = ENUM_PHRASES[check.field];
    if (!phrases) return [];
    const wanted = phrases[check.allowed[0]];
    const offending = typeof contractValue === "string" ? phrases[contractValue] : undefined;
    const out: LanguageAssertion[] = [];
    if (wanted) out.push({ kind: "contains_phrase", phrase: wanted });
    if (offending && offending !== wanted) out.push({ kind: "absent_phrase", phrase: offending });
    return out;
  }

  return [];
}

function describe(check: TermCheck, value: TermValue): string {
  if (check.kind === "number") {
    const bound = { lte: "at most", lt: "under", eq: "exactly", gte: "at least", gt: "over" }[check.comparator];
    return `${check.label} is ${value}, and CD's position is ${bound} ${check.value} ${check.unit}`;
  }
  if (check.kind === "enum") {
    return `${check.label} is "${value}", and CD's position allows only ${check.allowed.map((a) => `"${a}"`).join(", ")}`;
  }
  return `${check.label} is ${value}, and CD's position is ${check.expected}`;
}

/**
 * Total room revenue, the one figure every contract states outright.
 * Used only where an exposure figure follows from it in a single step.
 */
const roomNights = (spec: EvalContractSpec) => spec.room_block * spec.nights;

function exposureFor(spec: EvalContractSpec, clauseType: string): ExposureExpectation {
  const position = POSITION_BY_CLAUSE.get(clauseType)!;

  // A disclosed resort fee is the one exposure the contract computes in one
  // step from figures it states: the fee, the block, and the nights.
  if (clauseType === "mandatory_fees") {
    const terms = spec.terms[clauseType];
    const fee = terms !== "absent" ? terms.resort_fee_usd : undefined;
    if (typeof fee === "number" && fee > 0) {
      return { mode: "required", amount: fee * roomNights(spec), tolerance: 0.25 };
    }
  }

  return { mode: position.exposure };
}

/** Rejects a spec whose terms do not line up with the position they are checked against. */
function validateClauseTerms(spec: EvalContractSpec, clauseType: string, terms: Record<string, TermValue>) {
  const expected = new Set(clauseFields(clauseType));
  const given = new Set(Object.keys(terms));

  const missing = [...expected].filter((f) => !given.has(f));
  const extra = [...given].filter((f) => !expected.has(f));

  // A missing field reads as undefined, which fails a boolean check and silently
  // invents a key item. An extra field is a typo whose intended field is still
  // missing. Both have to be errors, not warnings.
  if (missing.length || extra.length) {
    throw new Error(
      `Spec "${spec.id}" clause "${clauseType}": ` +
        [missing.length ? `missing field(s) ${missing.join(", ")}` : "", extra.length ? `unknown field(s) ${extra.join(", ")}` : ""]
          .filter(Boolean)
          .join("; ") +
        "."
    );
  }
}

export function deriveKeyItems(spec: EvalContractSpec, standards: StandardEntry[]): PendingKeyItem[] {
  const severityOf = new Map(standards.map((s) => [s.clause_type as string, s.severity_default]));

  const declared = new Set(Object.keys(spec.terms));
  const known = new Set(CD_POSITIONS.map((p) => p.clause_type));
  const undeclared = [...known].filter((c) => !declared.has(c));
  const unknown = [...declared].filter((c) => !known.has(c));
  if (undeclared.length || unknown.length) {
    throw new Error(
      `Spec "${spec.id}" must state every clause type exactly once. ` +
        [undeclared.length ? `Missing: ${undeclared.join(", ")}` : "", unknown.length ? `Not in the library: ${unknown.join(", ")}` : ""]
          .filter(Boolean)
          .join(". ")
    );
  }

  const items: PendingKeyItem[] = [];

  for (const position of CD_POSITIONS) {
    const clauseType = position.clause_type;
    const severity = severityOf.get(clauseType);
    if (!severity) {
      throw new Error(`Clause type "${clauseType}" has a transcribed position but no entry in the standards library.`);
    }

    const clause = spec.terms[clauseType];
    const id = `${spec.id}:${clauseType}`;

    if (clause === "absent") {
      items.push({
        id,
        contract: spec.id,
        kind: "absent",
        clause_type: clauseType,
        severity,
        anchor_field: null,
        failed_fields: position.checks.map((c) => c.field),
        // Every check is unmet by an absent clause, so a correct replacement
        // has to satisfy all of them, not merely one.
        expected_language: position.checks.flatMap((c) => assertionsFor(c, "")),
        exposure: exposureFor(spec, clauseType),
        rationale: `The contract has no ${clauseType.replace(/_/g, " ")} clause. CD's standard calls for one.`,
      });
      continue;
    }

    validateClauseTerms(spec, clauseType, clause);

    const failed = position.checks.filter((check) => !checkPasses(check, clause[check.field]));
    if (failed.length === 0) continue;

    items.push({
      id,
      contract: spec.id,
      kind: "present",
      clause_type: clauseType,
      severity,
      // The first failing check in declaration order, so the anchor points at
      // wording that is actually adverse rather than at the clause's opening.
      anchor_field: failed[0].field,
      failed_fields: failed.map((c) => c.field),
      expected_language: failed.flatMap((check) => assertionsFor(check, clause[check.field])),
      exposure: exposureFor(spec, clauseType),
      rationale: failed.map((check) => describe(check, clause[check.field])).join("; ") + ".",
    });
  }

  return items;
}

/** Clause types this contract's key expects to have been considered — all of them. */
export const expectedCoverage = (): string[] => CD_POSITIONS.map((p) => p.clause_type);

/**
 * Attaches anchors to derived items, producing the finished key for one contract.
 *
 * A key item's anchors are EVERY anchor in its clause, not only the one for the
 * field that failed. One key item stands for one deviating clause, so a finding
 * quoting any sentence of that clause has found it — including the sentence
 * stating a term that was fine, and including the schedule table row that
 * carries a figure the prose never states. Anchoring only the failing field
 * would score those correct findings as a miss and a false positive at once.
 *
 * A clause with no key item keeps its anchors attached to nothing, so a finding
 * quoting a compliant clause matches nothing and is reported as spurious. That
 * is the intended reading.
 */
export function resolveKeyItems(
  pending: PendingKeyItem[],
  anchors: Array<{ clause_type: string; text: string; span: AnchorSpan }>
): KeyItem[] {
  return pending.map((item) => {
    const mine = item.kind === "absent" ? [] : anchors.filter((a) => a.clause_type === item.clause_type);

    if (item.kind === "present" && mine.length === 0) {
      throw new Error(
        `Key item ${item.id} is a present-clause finding with no anchor. The clause was drafted but nothing located.`
      );
    }

    return {
      id: item.id,
      contract: item.contract,
      kind: item.kind,
      clause_type: item.clause_type,
      severity: item.severity,
      anchors: mine.map((a) => a.span),
      anchor_texts: mine.map((a) => a.text),
      expected_language: item.expected_language,
      exposure: item.exposure,
      rationale: item.rationale,
    };
  });
}
