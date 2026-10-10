import { describe, expect, it } from "vitest";
import type { LatestAction } from "@/lib/finding-actions";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { carriedPlacement, placementProblem, placementRow } from "@/lib/placement";
import { fakeDb, type Tables } from "./helpers/fake-db";

/**
 * A decision can say where a change belongs: the wording the associate picked
 * for it, or that it goes in the email to the property and not in the redline.
 */

const finding = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  analysis_id: "a1",
  clause_type: "attrition",
  severity: "high",
  category: "business",
  is_missing_clause: false,
  quoted_text: "office",
  location_section: null,
  headline: null,
  finding_text: "Unfavourable to the client.",
  cd_standard: "CD position.",
  proposed_language: "Office",
  ...over,
});

const action = (finding_id: string, over: Record<string, unknown> = {}) => ({
  finding_id,
  action: "accept",
  edited_language: null,
  edited_quote: null,
  quote_context: null,
  by_email: false,
  ...over,
});

async function actioned(tables: Tables) {
  return getActionedFindings(fakeDb(tables) as never, "a1");
}

describe("where an accepted change belongs", () => {
  it("uses the wording the associate picked, and the place", async () => {
    const { findings } = await actioned({
      findings: [finding("f1")],
      finding_actions: [action("f1", { edited_quote: "front office", quote_context: "The " })],
    });

    expect(findings[0]).toMatchObject({ quoted_text: "front office", quote_context: "The " });
  });

  it("keeps the model's quote when the associate picked nothing", async () => {
    const { findings } = await actioned({ findings: [finding("f1")], finding_actions: [action("f1")] });
    expect(findings[0]).toMatchObject({ quoted_text: "office", quote_context: null });
  });

  it("keeps a change sent by email out of the contract's files, and lists it apart", async () => {
    const { findings, byEmail } = await actioned({
      findings: [finding("redline"), finding("email")],
      finding_actions: [action("redline"), action("email", { by_email: true })],
    });

    expect(findings.map((f) => f.id)).toEqual(["redline"]);
    expect(byEmail.map((f) => f.id)).toEqual(["email"]);
    expect(Object.keys(byEmail[0])).not.toContain("byEmail");
  });

  it("reads a database from before the placement columns", async () => {
    const { findings, byEmail } = await actioned({
      findings: [finding("f1")],
      finding_actions: [{ finding_id: "f1", action: "accept", edited_language: null }],
    });

    expect(findings.map((f) => f.id)).toEqual(["f1"]);
    expect(byEmail).toEqual([]);
  });
});

describe("checking wording the associate picked", () => {
  const parts = [{ part: "document", text: "The sales office confirms each booking. The front office holds the keys." }];

  it("passes wording found once", () => {
    expect(placementProblem(parts, "The front office holds the keys.", null, null)).toBeNull();
  });

  it("passes wording found twice when the context says which", () => {
    expect(placementProblem(parts, "office", null, "The front ")).toBeNull();
  });

  it("asks for more when the wording is found twice", () => {
    expect(placementProblem(parts, "office", null, null)).toBe(
      "That wording appears 2 times in the contract. Select a little more of it, so it appears once."
    );
  });

  it("says so when the wording isn't there", () => {
    expect(placementProblem(parts, "the concierge desk on the third floor", null, null)).toBe(
      "That wording isn't in the contract. Select it again in the document."
    );
    expect(placementProblem(parts, "  ", null, null)).toMatch(/^Select the wording/);
  });
});

describe("the decision a placement saves", () => {
  const latest = (over: Partial<LatestAction> = {}): LatestAction => ({
    finding_id: "f1",
    action: "accept",
    edited_language: null,
    dismissal_reason: null,
    created_at: "2026-10-10T00:00:00Z",
    edited_quote: null,
    quote_context: null,
    by_email: false,
    ...over,
  });

  it("accepts the change at the wording picked", () => {
    expect(placementRow(null, { quote: "front office", context: "The " })).toEqual({
      action: "accept",
      edited_language: null,
      edited_quote: "front office",
      quote_context: "The ",
      by_email: false,
    });
  });

  it("keeps the associate's own wording", () => {
    expect(placementRow(latest({ action: "edit", edited_language: "Front Office" }), { quote: "front office" })).toMatchObject({
      action: "edit",
      edited_language: "Front Office",
    });
  });

  it("sends a change by email and keeps any wording already picked", () => {
    expect(placementRow(latest({ edited_quote: "front office", quote_context: "The " }), { byEmail: true })).toMatchObject({
      edited_quote: "front office",
      quote_context: "The ",
      by_email: true,
    });
  });

  it("puts a change back in the redline", () => {
    expect(placementRow(latest({ by_email: true }), { byEmail: false })).toMatchObject({ action: "accept", by_email: false });
  });

  it("carries a placement into a later accept or edit, and drops it on a dismissal", () => {
    expect(carriedPlacement(latest({ edited_quote: "front office", quote_context: "The ", by_email: true }))).toEqual({
      edited_quote: "front office",
      quote_context: "The ",
      by_email: true,
    });
    expect(carriedPlacement(latest({ action: "dismiss", edited_quote: "front office" }))).toEqual({});
  });

  it("carries nothing for a decision that never had a placement", () => {
    expect(carriedPlacement(latest())).toEqual({});
    expect(carriedPlacement(null)).toEqual({});
  });
});
