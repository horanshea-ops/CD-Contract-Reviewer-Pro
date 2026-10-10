import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assembleEmailedChanges,
  assemblePropertyEmailItems,
  emailedChangesText,
  withEmailedChanges,
  type PropertyActionRow,
  type PropertyEmailedFindingRow,
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
const HEADLINE = "Fee far above market with no mitigation duty";
const COMPROMISE = "Settle anywhere up to 60% if the hotel pushes back.";

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
    headline: HEADLINE,
    cd_standard: CD_STANDARD,
    quoted_text: "seventy-five percent (75%) of anticipated revenue",
    walk_away: "Do not sign above 65%.",
    compromise_range: COMPROMISE,
    category: "business",
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

describe("legal findings and compromise ranges", () => {
  it("never carries the compromise range", () => {
    const items = assemblePropertyEmailItems([pollutedRow()], [action()]);
    expect(buildPropertyEmailPayload(items, "The Grand Riverside Hotel")).not.toContain(COMPROMISE);
  });

  it("drops a legal finding, even one accepted or edited with wording", () => {
    const legal = pollutedRow({ id: "f2", category: "legal", clause_type: "governing_law_venue", proposed_language: "" });
    const items = assemblePropertyEmailItems(
      [pollutedRow(), legal],
      [action(), action({ finding_id: "f2", action: "edit", edited_language: "Governed by Group's state law." })]
    );
    expect(items.map((i) => i.clause_type)).toEqual(["cancellation"]);
    expect(buildPropertyEmailPayload(items, "The Grand Riverside Hotel")).not.toContain("Group's state law");
  });
});

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

  it("drops the headline, which summarises CD's rationale", () => {
    expect(payload).not.toContain(HEADLINE);
    expect(payload).not.toMatch(/mitigation duty/i);
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

describe("what the property email is assembled from", () => {
  it("never reads the analysis row, where the model's notes on the document live", async () => {
    // The notes are CD's internal reading of the contract, like finding_text.
    const source = await readFile("lib/email-drafting/property-assembly.ts", "utf8");
    expect(source).not.toMatch(/from\("analyses"\)/);
    expect(source).not.toContain("document_notes");
  });
});

/**
 * A change the associate sends in the email itself, because the redline has no
 * place for it. Code writes the list after the model's draft. The model is
 * never given it.
 */
describe("changes sent in the email itself", () => {
  const emailedRow = (overrides: Record<string, unknown> = {}) => pollutedRow(overrides) as unknown as PropertyEmailedFindingRow;
  const BY_EMAIL = action({ by_email: true });
  const SENSITIVE = [RATIONALE, CD_STANDARD, EXPOSURE_BASIS, HEADLINE, COMPROMISE, "42000", "42,000", "Do not sign above", "high"];

  it("carries the clause, the contract's wording and the proposed wording, and nothing else", () => {
    expect(assembleEmailedChanges([emailedRow()], [BY_EMAIL])).toEqual([
      {
        clause_type: "cancellation",
        contract_wording: "seventy-five percent (75%) of anticipated revenue",
        proposed_language: "fifty percent (50%) of anticipated revenue",
      },
    ]);
  });

  it("writes none of CD's position into the email's list", () => {
    const text = emailedChangesText(assembleEmailedChanges([emailedRow()], [BY_EMAIL]));
    for (const leak of SENSITIVE) expect(text, leak).not.toContain(leak);
  });

  it("writes the list in fixed words", () => {
    expect(emailedChangesText(assembleEmailedChanges([emailedRow()], [BY_EMAIL]))).toBe(
      [
        "One further change is not shown in the attached contract:",
        "",
        "1. Cancellation",
        'Current wording: "seventy-five percent (75%) of anticipated revenue"',
        'Proposed wording: "fifty percent (50%) of anticipated revenue"',
      ].join("\n")
    );
  });

  it("uses the wording the associate picked, and their edit", () => {
    const [change] = assembleEmailedChanges(
      [emailedRow()],
      [action({ action: "edit", edited_language: "sixty percent (60%)", by_email: true, edited_quote: "75% of anticipated revenue" })]
    );
    expect(change).toMatchObject({ contract_wording: "75% of anticipated revenue", proposed_language: "sixty percent (60%)" });
  });

  it("calls an added clause a new provision", () => {
    const text = emailedChangesText(assembleEmailedChanges([emailedRow({ is_missing_clause: true })], [BY_EMAIL]));
    expect(text).toContain("This is a new provision.");
    expect(text).not.toContain("Current wording");
  });

  it("lists only accepted business changes the associate sent by email", () => {
    expect(assembleEmailedChanges([emailedRow()], [action()])).toEqual([]);
    expect(assembleEmailedChanges([emailedRow()], [action({ action: "dismiss", by_email: true })])).toEqual([]);
    expect(assembleEmailedChanges([emailedRow({ category: "legal" })], [BY_EMAIL])).toEqual([]);
    expect(assembleEmailedChanges([emailedRow()], [])).toEqual([]);
  });

  it("keeps such a change out of what the model is given", () => {
    expect(assemblePropertyEmailItems([pollutedRow()], [BY_EMAIL])).toEqual([]);
    expect(assemblePropertyEmailItems([pollutedRow()], [action()])).toHaveLength(1);
  });

  it("adds the list after the draft, and adds nothing when there is none", () => {
    const changes = assembleEmailedChanges([emailedRow()], [BY_EMAIL]);
    expect(withEmailedChanges("Dear team,\n\nPlease see the attached.\n", changes)).toMatch(
      /^Dear team,\n\nPlease see the attached\.\n\nOne further change is not shown/
    );
    expect(withEmailedChanges("Dear team,", [])).toBe("Dear team,");
  });
});
