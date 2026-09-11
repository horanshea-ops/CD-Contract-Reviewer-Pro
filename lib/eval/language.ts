import { collapseWhitespace, normalizeText } from "../docx/normalize";
import { parseQuantities } from "../quantities";
import type { Comparator, LanguageAssertion, LanguageCheck } from "./types";

/**
 * Grading proposed_language (MASTER_PLAN.md §2.0.1).
 *
 * Replacement wording cannot be compared to a reference answer. Two correct
 * rewrites of the same clause share almost no words, so any reference string
 * would fail most correct proposals and report the failure as the model's.
 *
 * So the key asserts properties instead, and only properties it can actually
 * check. Where a term is a number, the replacement has to put a number on CD's
 * side of the line. Where the wording is predictable — "cumulative" rather than
 * "night-by-night" — the phrase has to appear. Where a term is an obligation
 * that can be written a dozen ways, the key asserts nothing at all, and the
 * report says how many pairs were graded so the rate is read for what it is.
 *
 * The numeric check is deliberately generous: any figure in the right unit
 * satisfying the bound passes. A tighter rule keyed on proximity to a label
 * would fail correct rewrites that happen to phrase things differently, and a
 * false failure is reported as model error. A false pass only makes this one
 * rate slightly optimistic, which is the safer direction to be wrong in.
 */

const flatten = (s: string) => collapseWhitespace(normalizeText(s)).toLowerCase();

const satisfies = (value: number, comparator: Comparator, bound: number) => {
  switch (comparator) {
    case "lte":
      return value <= bound;
    case "lt":
      return value < bound;
    case "eq":
      return value === bound;
    case "gte":
      return value >= bound;
    case "gt":
      return value > bound;
  }
};

const COMPARATOR_WORDS: Record<Comparator, string> = {
  lte: "at most",
  lt: "under",
  eq: "exactly",
  gte: "at least",
  gt: "over",
};

/** Bracketed placeholders the property must never receive — "[Group Name]", "[DATES]". */
const PLACEHOLDER = /\[[^\]\n]{2,40}\]/;

function checkAssertion(assertion: LanguageAssertion, proposal: string): LanguageCheck {
  const flat = flatten(proposal);

  if (assertion.kind === "contains_phrase") {
    const wanted = flatten(assertion.phrase);
    return {
      name: `says "${assertion.phrase}"`,
      passed: flat.includes(wanted),
      detail: flat.includes(wanted) ? "present" : "the replacement never uses this wording",
    };
  }

  if (assertion.kind === "absent_phrase") {
    const unwanted = flatten(assertion.phrase);
    const present = flat.includes(unwanted);
    return {
      name: `drops "${assertion.phrase}"`,
      passed: !present,
      detail: present ? "the replacement keeps the wording it was meant to remove" : "removed",
    };
  }

  const wanted = `${assertion.label} ${COMPARATOR_WORDS[assertion.comparator]} ${assertion.value}`;
  const candidates = parseQuantities(proposal).filter((q) => q.unit === assertion.unit);

  if (candidates.length === 0) {
    return {
      name: wanted,
      passed: false,
      detail: `the replacement states no figure in ${assertion.unit}`,
    };
  }

  const satisfying = candidates.filter((q) => satisfies(q.value, assertion.comparator, assertion.value));
  return {
    name: wanted,
    passed: satisfying.length > 0,
    detail:
      satisfying.length > 0
        ? `satisfied by ${satisfying.map((q) => q.value).join(", ")}`
        : `the only figures offered are ${candidates.map((q) => q.value).join(", ")}`,
  };
}

/**
 * Checks every proposal, whatever the key asserts about it.
 *
 * These hold for any replacement in any clause, so they are not the key's
 * business. A blank replacement cannot be pasted anywhere; a bracketed
 * placeholder reaches the property as "[Group Name]"; and a replacement
 * identical to the wording it replaces changes nothing while reading as a fix.
 */
function universalChecks(proposal: string, quotedText: string | null): LanguageCheck[] {
  const trimmed = proposal.trim();
  const checks: LanguageCheck[] = [
    {
      name: "offers a replacement",
      passed: trimmed.length > 0,
      detail: trimmed.length > 0 ? `${trimmed.length} characters` : "empty",
    },
  ];

  const placeholder = trimmed.match(PLACEHOLDER);
  checks.push({
    name: "leaves no placeholder to fill in",
    passed: !placeholder,
    detail: placeholder ? `contains ${placeholder[0]}` : "none",
  });

  if (quotedText && trimmed) {
    const unchanged = flatten(trimmed) === flatten(quotedText);
    checks.push({
      name: "changes the wording it replaces",
      passed: !unchanged,
      detail: unchanged ? "the replacement restates the quoted wording exactly" : "differs",
    });
  }

  return checks;
}

export interface LanguageGrade {
  passed: boolean;
  checks: LanguageCheck[];
  /** False when the key asserted nothing, so this pair contributes no rate. */
  graded: boolean;
}

export function gradeLanguage(
  assertions: LanguageAssertion[],
  proposal: string,
  quotedText: string | null
): LanguageGrade {
  const checks = [...universalChecks(proposal, quotedText), ...assertions.map((a) => checkAssertion(a, proposal))];
  return {
    passed: checks.every((c) => c.passed),
    checks,
    // Universal checks alone are not a judgment about this clause's terms, so a
    // key item asserting nothing is counted as ungraded rather than as a pass.
    graded: assertions.length > 0,
  };
}
