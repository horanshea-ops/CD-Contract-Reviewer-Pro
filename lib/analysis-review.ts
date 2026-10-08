import type { Finding } from "./anthropic";
import type { StandardEntry } from "./standards/types";
import { checkExposure } from "./exposure";

/**
 * Drops findings that propose no change or would move the cutoff earlier,
 * and checks the rest against the review's own per-clause verdicts.
 *
 * Every consumer of findings (redline, memo, property email) reads a finding
 * as a change to make, so one that says "no change needed" would reach the
 * hotel as a proposed change to a clause that was already fine. Dropped
 * findings are kept with a reason, so nothing vanishes silently.
 *
 * The model states a verdict for every clause type before writing findings.
 * The two should agree, and where they don't, the disagreement is recorded
 * rather than resolved. Which side is right is an eval question, not one this
 * code can answer.
 */

export type ClauseVerdict = "meets" | "falls_short" | "missing" | "not_applicable";

/** Verdicts that say the contract needs no change on a clause type. */
const NEEDS_NO_CHANGE: ClauseVerdict[] = ["meets", "not_applicable"];

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
  reason: "placeholder" | "proposes_no_change" | "moves_cutoff_earlier";
}

export interface ReconciledReview {
  findings: Finding[];
  clause_review: ClauseReview[];
  clauses_checked: string[];
  review_gaps: ReviewGap[];
  dropped_findings: DroppedFinding[];
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

// The count in "(14 DAYS ) days prior" or "twenty-one (21) days before".
const DAYS_BEFORE = /(\d{1,3})\s*(?:days?\s*)?\)?\s*days?\s+(?:prior|before)/i;

const daysBefore = (text: string | null | undefined) => {
  const m = (text ?? "").match(DAYS_BEFORE);
  return m ? Number(m[1]) : null;
};

/**
 * Whether a cutoff finding asks for a deadline further from arrival than the
 * contract gives. More days before arrival is an earlier cutoff, which gives
 * attendees less time at the group rate. The model has proposed this more
 * than once, reading CD's 21-day fallback as a floor.
 */
export function movesCutoffEarlier(finding: Finding): boolean {
  if (finding.clause_type !== "cutoff_date") return false;
  const contract = daysBefore(finding.quoted_text);
  const proposed = daysBefore(finding.proposed_language);
  return contract !== null && proposed !== null && proposed > contract;
}

const PLACEHOLDER = /^\s*placeholder\b/i;

/**
 * Whether a finding is a stand-in the model never filled in. It writes the
 * word "placeholder" into a finding now and then, or leaves one with no text
 * of its own. Accepted, such a finding would put that word into a redline.
 */
export function isPlaceholder(finding: Finding): boolean {
  if ([finding.headline, finding.finding_text, finding.proposed_language].some((field) => PLACEHOLDER.test(field ?? ""))) return true;
  return !finding.headline?.trim() && !finding.finding_text?.trim();
}

export function dropNonChanges(findings: Finding[]): { findings: Finding[]; dropped_findings: DroppedFinding[] } {
  const dropped_findings: DroppedFinding[] = [];
  const kept = findings.filter((finding) => {
    const reason = isPlaceholder(finding)
      ? "placeholder"
      : proposesNoChange(finding)
        ? "proposes_no_change"
        : movesCutoffEarlier(finding)
          ? "moves_cutoff_earlier"
          : null;
    if (!reason) return true;
    dropped_findings.push({ finding, reason });
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

/** A clause type's name in one spelling, so two mentions of it compare equal. */
export const clauseKey = (clauseType: string) => clauseType.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The clause types a review judged short of the standard that no finding covers. */
export function skippedClauses(gaps: ReviewGap[], findings: Pick<Finding, "clause_type">[]): string[] {
  const covered = new Set(findings.map((f) => clauseKey(f.clause_type)));
  return gaps
    .filter((gap) => gap.kind === "short_without_finding" && !covered.has(clauseKey(gap.clause_type)))
    .map((gap) => gap.clause_type);
}

/**
 * One note for a review that judged clauses short of the standard and wrote
 * no finding for them, or null when every such clause has a finding. Without
 * it the associate has no way to tell the review left those clauses out.
 */
export function skippedClausesNote(gaps: ReviewGap[], findings: Pick<Finding, "clause_type">[]): { headline: string; detail: string } | null {
  const skipped = skippedClauses(gaps, findings).map((clauseType) => clauseType.replace(/_/g, " "));
  if (skipped.length === 0) return null;

  const clauses = skipped.length === 1 ? "1 clause" : `${skipped.length} clauses`;
  return {
    headline: `The review left ${clauses} without a finding.`,
    detail: `It judged ${skipped.length === 1 ? "this" : "these"} short of the standard and wrote nothing: ${skipped.join(", ")}. Read ${skipped.length === 1 ? "it" : "them"} yourself, or run the review again.`,
  };
}

export function reconcileReview(
  review: { findings: Finding[]; clause_review: ClauseReview[] },
  standards: StandardEntry[]
): ReconciledReview {
  const { findings, dropped_findings } = dropNonChanges(normalizeFindings(review.findings));

  const verdicts = new Map(review.clause_review.map((entry) => [clauseKey(entry.clause_type), entry]));
  const flagged = new Set(findings.map((finding) => clauseKey(finding.clause_type)));
  const review_gaps: ReviewGap[] = [];

  for (const { clause_type } of standards) {
    const entry = verdicts.get(clauseKey(clause_type));
    if (!entry) {
      review_gaps.push({ kind: "no_verdict", clause_type });
    } else if (!NEEDS_NO_CHANGE.includes(entry.verdict) && !flagged.has(clauseKey(clause_type))) {
      review_gaps.push({ kind: "short_without_finding", clause_type, verdict: entry.verdict });
    }
  }

  for (const clauseType of flagged) {
    const verdict = verdicts.get(clauseType)?.verdict;
    if (verdict && NEEDS_NO_CHANGE.includes(verdict)) {
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
