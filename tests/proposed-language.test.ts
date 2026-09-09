import { describe, expect, it } from "vitest";
import { assertsNoChange } from "@/lib/proposed-language";
import { assembleEmailFindings, type ActionRow, type FindingRow } from "@/lib/email-drafting/input-assembly";
import {
  assemblePropertyEmailItems,
  type PropertyActionRow,
  type PropertyFindingRow,
} from "@/lib/email-drafting/property-assembly";

/**
 * One definition, shared by every path that turns a finding into something a
 * person reads. Found live: an accepted finding whose proposed language was
 * "No change needed — retain as drafted." replaced a real rate-parity clause in
 * a contract bound for the property.
 */
describe("assertsNoChange", () => {
  it.each([
    "No change needed — retain as drafted.",
    "No change recommended; clause matches CD standard as written.",
    "No changes required.",
    "No revision needed.",
    "No edits.",
    "No amendment needed.",
    "None needed.",
    "Not applicable.",
    "N/A",
    "Retain as drafted.",
    "Retain as written.",
    "Acceptable as drafted.",
    "  no change needed  ",
  ])("recognises %j as commentary", (language) => {
    expect(assertsNoChange(language)).toBe(true);
  });

  it.each([
    "No guestroom shall be sold below the Group rate during the Event.",
    "Any change to the Group rate requires written consent of both parties.",
    "None of the foregoing limits the Group's right to terminate.",
    "Notice shall be given in writing.",
    "Retain the right to audit the master account.",
    "The attrition threshold shall be eighty percent (80%).",
  ])("leaves clause text alone: %j", (language) => {
    expect(assertsNoChange(language)).toBe(false);
  });

  it("treats missing language as not an assertion", () => {
    expect(assertsNoChange(null)).toBe(false);
    expect(assertsNoChange(undefined)).toBe(false);
    expect(assertsNoChange("")).toBe(false);
  });
});

function clientRow(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "f1",
    clause_type: "rate_parity",
    severity: "low",
    is_missing_clause: false,
    quoted_text: "Hotel guarantees not to sell guestrooms at a lower rate.",
    finding_text: "Matches CD standard.",
    proposed_language: "No change needed — retain as drafted.",
    exposure_amount: null,
    exposure_basis: null,
    ...overrides,
  };
}

const accept = (id = "f1"): ActionRow => ({
  finding_id: id,
  action: "accept",
  edited_language: null,
  created_at: "2026-09-09T00:00:00.000Z",
});

describe("client email input", () => {
  it("leaves out a finding proposing no change", () => {
    expect(assembleEmailFindings([clientRow()], [accept()])).toHaveLength(0);
  });

  it("keeps a real proposed change alongside it", () => {
    const result = assembleEmailFindings(
      [clientRow(), clientRow({ id: "f2", clause_type: "attrition", proposed_language: "The threshold shall be eighty percent (80%)." })],
      [accept(), accept("f2")]
    );
    expect(result.map((f) => f.clause_type)).toEqual(["attrition"]);
  });

  it("uses the associate's edited language when judging", () => {
    const result = assembleEmailFindings(
      [clientRow({ proposed_language: "The threshold shall be eighty percent (80%)." })],
      [{ ...accept(), action: "edit", edited_language: "No change needed after all." }]
    );
    expect(result).toHaveLength(0);
  });
});

function propertyRow(overrides: Partial<PropertyFindingRow> = {}): PropertyFindingRow {
  return {
    id: "f1",
    clause_type: "rate_parity",
    is_missing_clause: false,
    proposed_language: "No change needed — retain as drafted.",
    ...overrides,
  };
}

const propertyAccept = (id = "f1"): PropertyActionRow => ({
  finding_id: id,
  action: "accept",
  edited_language: null,
  created_at: "2026-09-09T00:00:00.000Z",
});

describe("property email input", () => {
  it("leaves out a finding proposing no change", () => {
    expect(assemblePropertyEmailItems([propertyRow()], [propertyAccept()])).toHaveLength(0);
  });

  it("keeps a real proposed change alongside it", () => {
    const result = assemblePropertyEmailItems(
      [propertyRow(), propertyRow({ id: "f2", clause_type: "attrition", proposed_language: "The threshold shall be eighty percent (80%)." })],
      [propertyAccept(), propertyAccept("f2")]
    );
    expect(result.map((i) => i.clause_type)).toEqual(["attrition"]);
  });
});
