import { describe, expect, it } from "vitest";
import { previewFindings, type PreviewFinding } from "@/lib/redline-engine/preflight";

/**
 * What a card says about its change before export.
 *
 * A real review let an associate accept a change with "[X]" in it, and only
 * the export said it couldn't go in. The contract wording here is invented.
 */

const RELEASE = "On the cutoff date we will return any unreserved rooms in the block to general inventory for resale.";
const AFTER = "Reservations received after the cutoff date will be accepted on a space and rate available basis.";
const SERVICE = "Food and beverage prices are subject to a service charge of twenty-one percent (21%).";
const CONTRACT = `The cutoff date is thirty days before arrival. ${RELEASE}\n${AFTER}\n${SERVICE}`;

const finding = (over: Partial<PreviewFinding>): PreviewFinding => ({
  id: "f1",
  quoted_text: null,
  is_missing_clause: false,
  language: "",
  ...over,
});

const preview = (f: PreviewFinding, contract: string | null = CONTRACT) => previewFindings([f], contract).get(f.id);

describe("previewFindings", () => {
  it("says a blank must be filled before the change can go in", () => {
    const out = preview(
      finding({ quoted_text: SERVICE, language: "Food and beverage prices carry a gratuity of [X]% and a service charge of 21%." })
    );
    expect(out).toEqual({
      export_issue: "Won't go into the redline yet: the wording still has a blank, [X]. Use Edit to fill it in.",
      redline_language: null,
    });
  });

  it("checks the wording for blanks even without the contract text", () => {
    const out = preview(finding({ quoted_text: SERVICE, language: "A gratuity of [X]% applies." }), null);
    expect(out?.export_issue).toContain("[X]");
  });

  it("says a quote-less rewrite of existing wording can't be marked up", () => {
    const out = preview(
      finding({
        is_missing_clause: true,
        language:
          "Reservations received after the cutoff date will be accepted on a space and rate available basis at the group rate.",
      })
    );
    expect(out?.export_issue).toContain("quotes none of it");
  });

  it("names the reworded sentence the redline leaves out, and gives the wording that will go in", () => {
    const out = preview(
      finding({
        quoted_text: AFTER,
        language:
          "On the cutoff date, after consultation with you, we will return any unreserved rooms in the block to general inventory for resale. Reservations received after the cutoff date will be accepted at the group rate.",
      })
    );
    expect(out).toEqual({
      export_issue:
        "Part of this won't go in: the redline leaves out a rewrite of wording it doesn't quote (\"On the cutoff date, after consultation with you…\"). Raise that change another way, or use Edit.",
      redline_language: "Reservations received after the cutoff date will be accepted at the group rate.",
    });
  });

  it("gives the trimmed wording without a warning when only a restated sentence is left out", () => {
    const out = preview(
      finding({ quoted_text: AFTER, language: `Reservations received after the cutoff date will be accepted at the group rate. ${RELEASE}` })
    );
    expect(out).toEqual({
      export_issue: null,
      redline_language: "Reservations received after the cutoff date will be accepted at the group rate.",
    });
  });

  it("says a change across a table row won't go in unless its wording is split to match the cells", () => {
    const row = "| 90 Days or Less | $50,000.00 | $20,000.00 |";
    expect(preview(finding({ quoted_text: row, language: "Fees are seventy percent of room profit at every tier." }))?.export_issue).toBe(
      "Won't go into the redline: the quote spans 3 table cells, and the wording can't be laid out across them. Use Edit to change the cells one at a time, or raise it another way."
    );
    expect(preview(finding({ quoted_text: row, language: "90 Days or Less | $35,000.00 | $20,000.00" }))?.export_issue).toBeNull();
  });

  describe("a quote that runs across table cells without the separators", () => {
    const TABLE = `Cancellation fees:\n\n| Notice | Room fee | Food fee |\n| --- | --- | --- |\n| 90 Days or Less | $50,000.00 | $20,000.00 |\n`;
    const quote = "90 Days or Less $50,000.00";

    it("says nothing when each change sits inside one cell", () => {
      expect(preview(finding({ quoted_text: quote, language: "90 Days or Less $35,000.00" }), TABLE)?.export_issue).toBeNull();
    });

    it("warns when the wording can't be laid out across the cells", () => {
      expect(
        preview(finding({ quoted_text: quote, language: "Fees are seventy percent of room profit at every tier." }), TABLE)
          ?.export_issue
      ).toMatch(/^Won't go into the redline: the quote spans 2 table cells/);
    });
  });

  it("says nothing about a clean change", () => {
    const out = preview(
      finding({ quoted_text: AFTER, language: "Reservations received after the cutoff date will be accepted at the group rate." })
    );
    expect(out).toEqual({ export_issue: null, redline_language: null });
  });
});
