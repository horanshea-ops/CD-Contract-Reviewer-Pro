import { describe, expect, it } from "vitest";
import { assembleEmailFindings, type ActionRow, type FindingRow } from "@/lib/email-drafting/input-assembly";

function finding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "f1",
    clause_type: "cancellation",
    severity: "high",
    is_missing_clause: false,
    quoted_text: "seventy-five percent (75%) of anticipated revenue",
    finding_text: "Cancellation fee is well above market.",
    proposed_language: "fifty percent (50%) of anticipated revenue",
    exposure_amount: 42000,
    exposure_basis: "difference between 75% and 50% of projected room revenue",
    ...overrides,
  };
}

function action(overrides: Partial<ActionRow> = {}): ActionRow {
  return {
    finding_id: "f1",
    action: "accept",
    edited_language: null,
    created_at: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("assembleEmailFindings", () => {
  it("excludes a dismissed finding", () => {
    const result = assembleEmailFindings([finding()], [action({ action: "dismiss" })]);
    expect(result).toHaveLength(0);
  });

  it("excludes a finding with no recorded action at all", () => {
    const result = assembleEmailFindings([finding()], []);
    expect(result).toHaveLength(0);
  });

  it("includes an accepted finding with the model's proposed language", () => {
    const result = assembleEmailFindings([finding()], [action({ action: "accept" })]);
    expect(result).toHaveLength(1);
    expect(result[0].language).toBe("fifty percent (50%) of anticipated revenue");
  });

  it("prefers the associate's edited language over the proposed language", () => {
    const result = assembleEmailFindings(
      [finding()],
      [action({ action: "edit", edited_language: "sixty percent (60%) of anticipated revenue" })]
    );
    expect(result[0].language).toBe("sixty percent (60%) of anticipated revenue");
  });

  it("carries exposure_amount and exposure_basis through", () => {
    const result = assembleEmailFindings([finding()], [action()]);
    expect(result[0].exposure_amount).toBe(42000);
    expect(result[0].exposure_basis).toBe("difference between 75% and 50% of projected room revenue");
  });

  it("uses only the latest action when a finding was re-decided", () => {
    const result = assembleEmailFindings(
      [finding()],
      [
        action({ action: "accept", created_at: "2026-09-01T00:00:00.000Z" }),
        action({ action: "dismiss", created_at: "2026-09-05T00:00:00.000Z" }),
      ]
    );
    expect(result).toHaveLength(0);
  });
});
