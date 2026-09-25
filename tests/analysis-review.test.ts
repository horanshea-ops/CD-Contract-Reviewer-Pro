import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/anthropic";
import { dropNonChanges, normalizeFindings, proposesNoChange } from "@/lib/analysis-review";

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

describe("dropNonChanges", () => {
  it("drops a finding that proposes no change, and records why", () => {
    const noChange = finding("attrition", "No change needed to the attrition allowance.");
    const kept = finding("cutoff_date");
    const result = dropNonChanges([noChange, kept]);
    expect(result.findings).toEqual([kept]);
    expect(result.dropped_findings).toEqual([{ finding: noChange, reason: "proposes_no_change" }]);
  });
});

describe("proposesNoChange", () => {
  // Each of these reached a saved eval run as a finding.
  it.each([
    "No change needed to the deposit amount; confirm the $0.00 security deposit remains in the final executed agreement.",
    "No change recommended; clause aligns with CD standard.",
    "No change required.",
    "No change necessary.",
    "No changes recommended.",
    "None.",
    "N/A",
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
    expect(stillMissing.is_missing_clause).toBe(true);
  });
});
