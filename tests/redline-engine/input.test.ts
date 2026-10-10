import { describe, expect, it } from "vitest";
import { dryRunFindings, type DryRunRow } from "@/lib/exports/dry-run";
import type { ActionedFinding } from "@/lib/get-actioned-findings";
import { toRevisionFinding } from "@/lib/redline-engine";

/**
 * The engine writes the file the property receives, so it is handed its own
 * fields and nothing else. A finding's rationale and CD's standard stop at
 * `toRevisionFinding`.
 */

const ENGINE_FIELDS = [
  "clause_type",
  "id",
  "is_missing_clause",
  "language",
  "location_section",
  "quote_context",
  "quoted_text",
  "severity",
];

const ACTIONED: ActionedFinding = {
  id: "f1",
  location_section: "Section 4",
  quote_context: "Group shall be liable for",
  clause_type: "attrition",
  severity: "high",
  is_missing_clause: false,
  quoted_text: "eighty percent (80%)",
  language: "seventy percent (70%)",
  finding_text: "SENTINEL-RATIONALE",
  cd_standard: "SENTINEL-STANDARD",
};

describe("toRevisionFinding", () => {
  it("passes the engine's fields and no others", () => {
    expect(Object.keys(toRevisionFinding(ACTIONED)).sort()).toEqual(ENGINE_FIELDS);
  });

  it("keeps each field's value", () => {
    expect(toRevisionFinding(ACTIONED)).toEqual({
      id: "f1",
      location_section: "Section 4",
      quote_context: "Group shall be liable for",
      clause_type: "attrition",
      severity: "high",
      is_missing_clause: false,
      quoted_text: "eighty percent (80%)",
      language: "seventy percent (70%)",
    });
  });

  it("drops the rationale and the standard", () => {
    expect(JSON.stringify(toRevisionFinding(ACTIONED))).not.toContain("SENTINEL");
  });

  it("drops a field added to the finding later", () => {
    const wider = { ...ACTIONED, compromise_range: "SENTINEL-RANGE", walk_away: "SENTINEL-WALK-AWAY" };
    expect(JSON.stringify(toRevisionFinding(wider))).not.toContain("SENTINEL");
  });
});

describe("dryRunFindings", () => {
  it("hands the card's check the engine's fields and no others", () => {
    // The review screen's row carries the rationale and the standard for the card.
    const row = {
      id: "f1",
      clause_type: "attrition",
      severity: "high",
      category: "business",
      is_missing_clause: false,
      quoted_text: "eighty percent (80%)",
      location_section: null,
      proposed_language: "seventy percent (70%)",
      current_action: null,
      finding_text: "SENTINEL-RATIONALE",
      cd_standard: "SENTINEL-STANDARD",
    } satisfies DryRunRow & Record<string, unknown>;

    const [finding] = dryRunFindings([row]);

    expect(Object.keys(finding).sort()).toEqual(ENGINE_FIELDS);
    expect(JSON.stringify(finding)).not.toContain("SENTINEL");
  });
});
