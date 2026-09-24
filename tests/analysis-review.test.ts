import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/anthropic";
import { normalizeFindings, proposesNoChange, reconcileReview, type ClauseReview } from "@/lib/analysis-review";
import type { StandardEntry } from "@/lib/standards/types";

function standard(clause_type: string): StandardEntry {
  return {
    clause_type,
    segment: "default",
    position: "",
    fallback_language: "",
    walk_away_condition: "",
    severity_default: "medium",
    version: "v1",
    provenance: "extracted",
  };
}

function finding(clause_type: string, proposed_language = "Replace with seventy percent (70%)."): Finding {
  return {
    clause_type,
    is_missing_clause: false,
    severity: "medium",
    location_section: null,
    quoted_text: "eighty percent (80%)",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Threshold too high.",
    cd_standard: "70%",
    proposed_language,
    model_confidence: "high",
  };
}

const verdict = (clause_type: string, v: ClauseReview["verdict"]): ClauseReview => ({
  clause_type,
  verdict: v,
  basis: "",
});

const STANDARDS = ["attrition", "cutoff_date", "force_majeure"].map(standard);

describe("reconcileReview", () => {
  it("records no gaps when verdicts and findings agree", () => {
    const result = reconcileReview(
      {
        findings: [finding("attrition")],
        clause_review: [verdict("attrition", "falls_short"), verdict("cutoff_date", "meets"), verdict("force_majeure", "meets")],
      },
      STANDARDS
    );
    expect(result.review_gaps).toEqual([]);
    expect(result.findings).toHaveLength(1);
  });

  it("derives clauses_checked from the verdicts", () => {
    const result = reconcileReview(
      { findings: [], clause_review: [verdict("attrition", "meets"), verdict("cutoff_date", "meets")] },
      STANDARDS
    );
    expect(result.clauses_checked).toEqual(["attrition", "cutoff_date"]);
  });

  it("flags a library clause type with no verdict", () => {
    const result = reconcileReview(
      { findings: [], clause_review: [verdict("attrition", "meets"), verdict("cutoff_date", "meets")] },
      STANDARDS
    );
    expect(result.review_gaps).toEqual([{ kind: "no_verdict", clause_type: "force_majeure" }]);
  });

  it("flags a falls_short or missing verdict with no finding", () => {
    const result = reconcileReview(
      {
        findings: [],
        clause_review: [verdict("attrition", "falls_short"), verdict("cutoff_date", "missing"), verdict("force_majeure", "meets")],
      },
      STANDARDS
    );
    expect(result.review_gaps).toEqual([
      { kind: "short_without_finding", clause_type: "attrition", verdict: "falls_short" },
      { kind: "short_without_finding", clause_type: "cutoff_date", verdict: "missing" },
    ]);
  });

  it("flags a finding on a clause the model called meets, and keeps the finding", () => {
    const result = reconcileReview(
      {
        findings: [finding("attrition")],
        clause_review: [verdict("attrition", "meets"), verdict("cutoff_date", "meets"), verdict("force_majeure", "meets")],
      },
      STANDARDS
    );
    expect(result.review_gaps).toEqual([{ kind: "finding_on_meets", clause_type: "attrition" }]);
    expect(result.findings).toHaveLength(1);
  });

  it("matches clause types regardless of case and spacing", () => {
    const result = reconcileReview(
      {
        findings: [finding("Force Majeure")],
        clause_review: [verdict("attrition", "meets"), verdict("Cutoff-Date", "meets"), verdict("force_majeure", "falls_short")],
      },
      STANDARDS
    );
    expect(result.review_gaps).toEqual([]);
  });

  it("drops a finding that proposes no change, and records why", () => {
    const noChange = finding("attrition", "No change needed to the attrition allowance.");
    const result = reconcileReview(
      {
        findings: [noChange, finding("cutoff_date")],
        clause_review: [verdict("attrition", "falls_short"), verdict("cutoff_date", "falls_short"), verdict("force_majeure", "meets")],
      },
      STANDARDS
    );
    expect(result.findings.map((f) => f.clause_type)).toEqual(["cutoff_date"]);
    expect(result.dropped_findings).toEqual([{ finding: noChange, reason: "proposes_no_change" }]);

    // With its only finding dropped, attrition's falls_short verdict stands alone.
    expect(result.review_gaps).toEqual([{ kind: "short_without_finding", clause_type: "attrition", verdict: "falls_short" }]);
  });
});

describe("proposesNoChange", () => {
  // The first five reached a saved eval run as findings.
  it.each([
    "No change needed to the deposit amount; confirm the $0.00 security deposit remains in the final executed agreement.",
    "No change recommended; clause aligns with CD standard.",
    "No change required.",
    "No change necessary.",
    "N/A",
    "No changes recommended.",
    "None.",
    "The clause is acceptable, so no change is required.",
  ])("catches %j", (language) => {
    expect(proposesNoChange(finding("attrition", language))).toBe(true);
  });

  it.each([
    "Replace with seventy percent (70%).",
    "Group may cancel with no change fee within 30 days of signing.",
    "No changes to the room block may be made without Group's written consent.",
  ])("keeps a real change: %j", (language) => {
    expect(proposesNoChange(finding("attrition", language))).toBe(false);
  });
});

describe("normalizeFindings", () => {
  it("treats a finding that quotes the contract as a change in place, not a missing clause", () => {
    const quoted = { ...finding("assignment_subcontracting"), is_missing_clause: true };
    const missing = { ...finding("named_storm"), is_missing_clause: true, quoted_text: null };
    const [inPlace, stillMissing] = normalizeFindings([quoted, missing]);
    expect(inPlace.is_missing_clause).toBe(false);
    expect(stillMissing).toBe(missing);
  });
});
