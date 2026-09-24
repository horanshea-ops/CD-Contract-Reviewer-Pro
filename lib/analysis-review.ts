import type { Finding } from "./anthropic";
import { checkExposure } from "./exposure";

/**
 * Drops findings that propose no change.
 *
 * Every consumer of findings (redline, memo, property email) reads a finding
 * as a change to make, so one that says "no change needed" would reach the
 * hotel as a proposed change to a clause that was already fine. Dropped
 * findings are kept with a reason, so nothing vanishes silently.
 */

export interface DroppedFinding {
  finding: Finding;
  reason: "proposes_no_change";
}

// Matches wording that declines to change anything: a bare "None" or "N/A",
// or "no change is needed" and its variants. A real change that mentions "no
// change" in passing, such as "no changes to the block without consent",
// survives.
const NO_CHANGE =
  /^\s*(none|n\/a|not applicable)\s*\.?\s*$|\bno (change|changes|revision|revisions) (is |are )?(needed|recommended|required|necessary)\b/i;

export function proposesNoChange(finding: Finding): boolean {
  return NO_CHANGE.test(finding.proposed_language ?? "");
}

export function dropNonChanges(findings: Finding[]): { findings: Finding[]; dropped_findings: DroppedFinding[] } {
  const dropped_findings: DroppedFinding[] = [];
  const kept = findings.filter((finding) => {
    if (!proposesNoChange(finding)) return true;
    dropped_findings.push({ finding, reason: "proposes_no_change" });
    return false;
  });
  return { findings: kept, dropped_findings };
}

/**
 * Findings as every export should read them.
 *
 * - A finding that quotes the contract is not about a missing clause. The
 *   model sometimes marks a clause missing because it lacks a required term,
 *   and still quotes the wording that is there. Every export reads "missing"
 *   as "add a new clause", which would leave the quoted wording beside a
 *   contradicting addition.
 * - The exposure figure is the result of its formula, worked out here. The
 *   model's own arithmetic was wrong often enough to reach the client email.
 */
export function normalizeFindings(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    const { exposure_amount, exposure_formula } = checkExposure(f);
    return {
      ...f,
      is_missing_clause: f.is_missing_clause && !f.quoted_text,
      exposure_amount,
      exposure_formula,
    };
  });
}
