import type { Finding } from "./anthropic";

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
