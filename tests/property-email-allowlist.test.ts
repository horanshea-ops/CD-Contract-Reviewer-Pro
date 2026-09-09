import { describe, expect, it } from "vitest";
import {
  assemblePropertyEmailItems,
  type PropertyActionRow,
  type PropertyFindingRow,
} from "@/lib/email-drafting/property-assembly";
import { buildPropertyEmailPayload } from "@/lib/anthropic";

/**
 * §1.8.3's allowlist. These tests assert on the string actually sent to the
 * model, not on the shape of a type — a type alone proves nothing about what
 * a widened DB row would carry through at runtime.
 */

const RATIONALE = "Cancellation fee is well above market and CD should push back hard.";
const CD_STANDARD = "CD standard is 50%; CD will not go above 60% without sign-off.";
const EXPOSURE_BASIS = "difference between 75% and 50% of projected room revenue";

/**
 * Deliberately polluted. Every excluded field is present, as it would be if a
 * future SELECT widened or someone passed a row from the client path. The cast
 * is the point — it simulates the leak the allowlist has to stop.
 */
function pollutedRow(overrides: Record<string, unknown> = {}): PropertyFindingRow {
  return {
    id: "f1",
    clause_type: "cancellation",
    is_missing_clause: false,
    proposed_language: "fifty percent (50%) of anticipated revenue",

    severity: "high",
    exposure_amount: 42000,
    exposure_basis: EXPOSURE_BASIS,
    finding_text: RATIONALE,
    cd_standard: CD_STANDARD,
    quoted_text: "seventy-five percent (75%) of anticipated revenue",
    walk_away: "Do not sign above 65%.",
    ...overrides,
  } as unknown as PropertyFindingRow;
}

function action(overrides: Partial<PropertyActionRow> = {}): PropertyActionRow {
  return {
    finding_id: "f1",
    action: "accept",
    edited_language: null,
    created_at: "2026-09-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("property email allowlist", () => {
  const items = assemblePropertyEmailItems([pollutedRow()], [action()]);
  const payload = buildPropertyEmailPayload(items, "The Grand Riverside Hotel");

  it("assembles exactly the three allowed fields and nothing else", () => {
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]).sort()).toEqual(["clause_type", "is_missing_clause", "proposed_language"]);
  });

  it("drops the exposure amount in every formatting a leak could take", () => {
    expect(payload).not.toContain("42000");
    expect(payload).not.toContain("42,000");
    expect(payload).not.toContain("$42");
    expect(payload).not.toContain(EXPOSURE_BASIS);
  });

  it("drops CD's rationale for flagging the clause", () => {
    expect(payload).not.toContain(RATIONALE);
    expect(payload).not.toMatch(/above market/i);
    expect(payload).not.toMatch(/push back/i);
  });

  it("drops CD's internal standard and fallback position", () => {
    expect(payload).not.toContain(CD_STANDARD);
    expect(payload).not.toMatch(/sign-off/i);
    expect(payload).not.toMatch(/CD standard/i);
  });

  it("drops walk-away conditions", () => {
    expect(payload).not.toMatch(/do not sign/i);
    expect(payload).not.toMatch(/walk.?away/i);
  });

  it("drops the severity rating", () => {
    expect(payload).not.toMatch(/\bseverity\b/i);
    expect(payload).not.toMatch(/\bhigh\b/i);
    expect(payload).not.toMatch(/\bmedium\b/i);
    expect(payload).not.toMatch(/\blow\b/i);
  });

  it("drops the property's original quoted text, so the payload invites no before/after framing", () => {
    expect(payload).not.toContain("seventy-five percent");
  });

  it("still carries what the property needs — the clause and the proposed language", () => {
    expect(payload).toContain("cancellation");
    expect(payload).toContain("fifty percent (50%) of anticipated revenue");
  });

  it("marks an added clause without revealing why it was added", () => {
    const added = assemblePropertyEmailItems([pollutedRow({ is_missing_clause: true })], [action()]);
    const addedPayload = buildPropertyEmailPayload(added, "The Grand Riverside Hotel");
    expect(addedPayload).toMatch(/not present in the current draft/i);
    expect(addedPayload).not.toContain(RATIONALE);
  });
});

describe("assemblePropertyEmailItems", () => {
  it("excludes a dismissed finding", () => {
    expect(assemblePropertyEmailItems([pollutedRow()], [action({ action: "dismiss" })])).toHaveLength(0);
  });

  it("excludes a finding with no recorded action at all", () => {
    expect(assemblePropertyEmailItems([pollutedRow()], [])).toHaveLength(0);
  });

  it("prefers the associate's edited language over the proposed language", () => {
    const result = assemblePropertyEmailItems(
      [pollutedRow()],
      [action({ action: "edit", edited_language: "sixty percent (60%) of anticipated revenue" })]
    );
    expect(result[0].proposed_language).toBe("sixty percent (60%) of anticipated revenue");
  });

  it("uses only the latest action when a finding was re-decided", () => {
    const result = assemblePropertyEmailItems(
      [pollutedRow()],
      [
        action({ action: "accept", created_at: "2026-09-08T00:00:00.000Z" }),
        action({ action: "dismiss", created_at: "2026-09-08T02:00:00.000Z" }),
      ]
    );
    expect(result).toHaveLength(0);
  });

  it("keeps a dismissed finding out even when other findings are accepted", () => {
    const result = assemblePropertyEmailItems(
      [pollutedRow(), pollutedRow({ id: "f2", clause_type: "attrition" })],
      [action(), action({ finding_id: "f2", action: "dismiss" })]
    );
    expect(result.map((i) => i.clause_type)).toEqual(["cancellation"]);
  });
});

/**
 * The layers are sequential, so a test that runs assembly first can never
 * exercise the payload builder with polluted input — assembly has already
 * stripped it. This block feeds the builder directly, so the two layers are
 * proven independently rather than one masking the other.
 */
describe("buildPropertyEmailPayload, given an item that should not have been assembled", () => {
  const polluted = [
    {
      clause_type: "cancellation",
      is_missing_clause: false,
      proposed_language: "fifty percent (50%) of anticipated revenue",

      severity: "high",
      exposure_amount: 42000,
      exposure_basis: EXPOSURE_BASIS,
      finding_text: RATIONALE,
      cd_standard: CD_STANDARD,
    },
  ] as unknown as Parameters<typeof buildPropertyEmailPayload>[0];

  const payload = buildPropertyEmailPayload(polluted, "The Grand Riverside Hotel");

  it("emits only the allowed fields, whatever else the item carries", () => {
    expect(payload).not.toContain("42000");
    expect(payload).not.toContain(EXPOSURE_BASIS);
    expect(payload).not.toContain(RATIONALE);
    expect(payload).not.toContain(CD_STANDARD);
    expect(payload).not.toMatch(/\bhigh\b/i);
    expect(payload).toContain("fifty percent (50%) of anticipated revenue");
  });
});

describe("buildPropertyEmailPayload label handling", () => {
  it("uses the label it is given and adds no other identifier", () => {
    const payload = buildPropertyEmailPayload(
      assemblePropertyEmailItems([pollutedRow()], [action()]),
      "the agreement"
    );
    expect(payload).toContain("the agreement");
    expect(payload).not.toMatch(/\.docx|\.pdf/i);
  });
});
