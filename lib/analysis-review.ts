import type { Finding } from "./anthropic";
import type { StandardEntry } from "./standards/types";

/**
 * Checks a review's findings against its own per-clause verdicts.
 *
 * The model states a verdict for every clause type before writing findings.
 * The two should agree, and where they don't, the disagreement is recorded
 * rather than resolved. Which side is right is an eval question, not one this
 * code can answer.
 *
 * One kind of finding is dropped outright, because it proposes no change. Every
 * consumer of findings (redline, memo, property email) reads a finding as a
 * change to make.
 */

export type ClauseVerdict = "meets" | "falls_short" | "missing";

export interface ClauseReview {
  clause_type: string;
  verdict: ClauseVerdict;
  basis: string;
}

export type ReviewGap =
  | { kind: "no_verdict"; clause_type: string }
  | { kind: "short_without_finding"; clause_type: string; verdict: ClauseVerdict }
  | { kind: "finding_on_meets"; clause_type: string };

export interface DroppedFinding {
  finding: Finding;
  reason: "proposes_no_change";
}

export interface ReconciledReview {
  findings: Finding[];
  clause_review: ClauseReview[];
  clauses_checked: string[];
  review_gaps: ReviewGap[];
  dropped_findings: DroppedFinding[];
}

const normalize = (clauseType: string) => clauseType.trim().toLowerCase().replace(/[\s-]+/g, "_");

// Matches wording that declines to change anything: a bare "None" or "N/A",
// or "no change is needed" and its variants. A real change that mentions "no
// change" in passing, such as "no changes to the block without consent",
// survives.
const NO_CHANGE =
  /^\s*(none|n\/a|not applicable)\s*\.?\s*$|\bno (change|changes|revision|revisions) (is |are )?(needed|recommended|required|necessary)\b/i;

export function proposesNoChange(finding: Finding): boolean {
  return NO_CHANGE.test(finding.proposed_language ?? "");
}

export function reconcileReview(
  review: { findings: Finding[]; clause_review: ClauseReview[] },
  standards: StandardEntry[]
): ReconciledReview {
  const dropped_findings: DroppedFinding[] = [];
  const findings = review.findings.filter((finding) => {
    if (!proposesNoChange(finding)) return true;
    dropped_findings.push({ finding, reason: "proposes_no_change" });
    return false;
  });

  const verdicts = new Map(review.clause_review.map((entry) => [normalize(entry.clause_type), entry]));
  const flagged = new Set(findings.map((finding) => normalize(finding.clause_type)));
  const review_gaps: ReviewGap[] = [];

  for (const { clause_type } of standards) {
    const entry = verdicts.get(normalize(clause_type));
    if (!entry) {
      review_gaps.push({ kind: "no_verdict", clause_type });
    } else if (entry.verdict !== "meets" && !flagged.has(normalize(clause_type))) {
      review_gaps.push({ kind: "short_without_finding", clause_type, verdict: entry.verdict });
    }
  }

  for (const clauseType of flagged) {
    if (verdicts.get(clauseType)?.verdict === "meets") {
      review_gaps.push({ kind: "finding_on_meets", clause_type: clauseType });
    }
  }

  return {
    findings,
    clause_review: review.clause_review,
    clauses_checked: review.clause_review.map((entry) => entry.clause_type),
    review_gaps,
    dropped_findings,
  };
}
