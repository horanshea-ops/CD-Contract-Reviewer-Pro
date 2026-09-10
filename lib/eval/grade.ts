import type { Finding } from "../anthropic";
import { clauseTypesAgree } from "./match";
import { gradeLanguage } from "./language";
import { severityRank } from "./types";
import type { ExposureVerdict, Grade, KeyItem, LocationStatus, QuoteVerdict, SeverityVerdict } from "./types";

/**
 * Grading one matched pair (MASTER_PLAN.md §2.0.1).
 *
 * Every dimension is graded on its own, because they fail on their own. A
 * finding can point at the right wording, call it the wrong clause type, get
 * the severity right and propose a replacement that changes nothing. Collapsing
 * that into one verdict throws away the only part of the report anyone can act
 * on — which of those four things to go and fix.
 *
 * Nothing here decides whether the pair exists. That is ./match's job, settled
 * before anything is graded, so a wrong clause type shows up as a wrong clause
 * type rather than as a finding that was never noticed.
 */

function gradeSeverity(item: KeyItem, finding: Finding): { verdict: SeverityVerdict; distance: number } {
  // SEVERITY_ORDER runs most severe first, so a lower rank is a louder call.
  const distance = severityRank(item.severity) - severityRank(finding.severity);
  if (distance === 0) return { verdict: "exact", distance };
  return { verdict: distance > 0 ? "over_called" : "under_called", distance };
}

function gradeQuote(location: LocationStatus): QuoteVerdict {
  switch (location.status) {
    case "located":
      return location.resolution;
    case "unlocatable":
      return "unlocatable";
    case "ambiguous":
      return "ambiguous";
    case "no_quote":
      return "none";
  }
}

/**
 * Grading exposure_amount.
 *
 * "forbidden" is the case worth reading carefully. The system prompt tells the
 * model a figure must be calculable from what the contract states and that it
 * must never estimate one, so a number attached to a clause carrying no figures
 * is a prompt violation rather than an arithmetic slip. The key only claims
 * that for clauses where nothing in a hotel contract bears on the amount at all.
 */
function gradeExposure(item: KeyItem, finding: Finding): ExposureVerdict {
  const given = finding.exposure_amount;

  switch (item.exposure.mode) {
    case "unspecified":
      return "not_applicable";

    case "forbidden":
      return given == null ? "correct" : "invented";

    case "required": {
      if (given == null) return "omitted";
      const expected = item.exposure.amount;
      if (expected == null || expected === 0) return "not_applicable";
      const tolerance = item.exposure.tolerance ?? 0.25;
      return Math.abs(given - expected) / expected <= tolerance ? "correct" : "out_of_tolerance";
    }
  }
}

export function gradePair(item: KeyItem, finding: Finding, location: LocationStatus): Grade {
  const language = gradeLanguage(item.expected_language, finding.proposed_language, finding.quoted_text);

  return {
    clause_type: clauseTypesAgree(item.clause_type, finding.clause_type) ? "correct" : "wrong",
    presence: (item.kind === "absent") === Boolean(finding.is_missing_clause) ? "correct" : "wrong",
    severity: gradeSeverity(item, finding),
    quote: gradeQuote(location),
    exposure: gradeExposure(item, finding),
    language: { passed: language.passed, checks: language.checks },
  };
}

/** Whether this pair's language verdict belongs in the rate, or only in the audit trail. */
export const languageWasGraded = (item: KeyItem) => item.expected_language.length > 0;
