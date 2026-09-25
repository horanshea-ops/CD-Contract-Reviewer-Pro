import { describe, expect, it } from "vitest";
import { OTHER_CLAUSE_TYPE, toOtherFindings } from "@/lib/other-findings";

/**
 * Terms outside the standards library, as the review stores them.
 *
 * A real contract carried a cross-default and a one-way damages waiver that no
 * library clause names. The wording here is invented.
 */

const CROSS_DEFAULT = {
  headline: "Breaching any other agreement with the hotel ends this one",
  quoted_text: "If you fail to perform under any other agreement between us, we may terminate this Agreement.",
  finding_text: "A missed payment on an unrelated booking would let the hotel cancel and charge cancellation fees.",
};

describe("toOtherFindings", () => {
  it("stores a term as a wordless finding in the Other bucket", () => {
    expect(toOtherFindings([CROSS_DEFAULT], "CD")).toEqual([
      {
        clause_type: OTHER_CLAUSE_TYPE,
        is_missing_clause: false,
        severity: "note",
        location_section: null,
        quoted_text: CROSS_DEFAULT.quoted_text,
        exposure_amount: null,
        exposure_formula: null,
        exposure_basis: null,
        headline: CROSS_DEFAULT.headline,
        finding_text: CROSS_DEFAULT.finding_text,
        cd_standard: "Not covered by CD's standards library. Raise it at your discretion.",
        proposed_language: "",
        model_confidence: "medium",
      },
    ]);
  });

  it("drops an item with no headline or no quote, and keeps at most six", () => {
    const items = [{ ...CROSS_DEFAULT, quoted_text: " " }, { ...CROSS_DEFAULT, headline: "" }, ...Array(8).fill(CROSS_DEFAULT)];
    expect(toOtherFindings(items, "CD")).toHaveLength(6);
  });

  it("gives nothing for anything that isn't a list", () => {
    expect(toOtherFindings(null, "CD")).toEqual([]);
    expect(toOtherFindings("[]", "CD")).toEqual([]);
  });
});
