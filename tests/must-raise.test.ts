import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/anthropic";
import { readFigures } from "@/lib/exposures/figures";
import { APP_RAISED, mustRaise } from "@/lib/must-raise";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";
import { HOTEL_TERM_CATALOG } from "@/lib/terms/catalog";
import { validateTerms } from "@/lib/terms/validate";

/**
 * The findings the app raises itself. Each case goes from the reader's raw
 * entries through the term checks, since a rule only acts on a checked number.
 * The wording is invented.
 */

const CONTRACT = [
  "Total Room Nights: 2,900",
  "You agree that you will use at least 2,280 room nights at the Hotel.",
  "We will pay to ConferenceDirect a commission of 8% of the Group Room Rate on all paid and occupied rooms.",
  "The agency commission is eight percent (8%) of room revenue.",
  "The shortfall payment rate shall be one hundred percent (100%) of the difference.",
  "Damages apply when pickup falls below the attrition threshold of ninety percent (90%).",
  "A fee of 8% applies, and a second fee of 8% applies after that.",
  "Hotel pays ten percent (10%) commission.",
].join("\n");
const parts = [{ part: "document", text: CONTRACT }];

const entry = (term_key: string, value: unknown, quoted_text: string) => ({ term_key, value, quoted_text, confidence: "high" });
const COMMISSION = entry("commission.commission_pct", 8, "We will pay to ConferenceDirect a commission of 8% of the Group Room Rate on all paid and occupied rooms.");
const BLOCK = entry("deal.room_block_room_nights", 2900, "Total Room Nights: 2,900");
const MINIMUM = entry("attrition.minimum_room_nights", 2280, "You agree that you will use at least 2,280 room nights at the Hotel.");

const run = (entries: unknown[], findings: Finding[] = []) => {
  const terms = validateTerms(entries, HOTEL_TERM_CATALOG, parts);
  return mustRaise(readFigures(terms).figures, terms, findings, STANDARDS_LIBRARY);
};

const modelFinding = (clause_type: string, quoted_text: string): Finding => ({
  clause_type,
  is_missing_clause: false,
  severity: "medium",
  location_section: null,
  quoted_text,
  exposure_amount: null,
  exposure_basis: null,
  finding_text: "Too low.",
  cd_standard: "",
  proposed_language: "Changed.",
  model_confidence: "high",
});

describe("mustRaise", () => {
  it("raises a commission below the standard when the review wrote nothing on it", () => {
    const { findings, uncovered } = run([COMMISSION]);

    expect(uncovered).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      clause_type: "commission",
      headline: "Commission is 8%, below the 10% standard",
      quoted_text: COMMISSION.quoted_text,
      proposed_language: "We will pay to ConferenceDirect a commission of 10% of the Group Room Rate on all paid and occupied rooms.",
      severity: STANDARDS_LIBRARY.find((s) => s.clause_type === "commission")!.severity_default,
      exposure_amount: null,
    });
    expect(findings[0].finding_text.startsWith(APP_RAISED)).toBe(true);
    expect(findings[0].cd_standard).toContain("10% commission");
  });

  it("changes a spelled-out percentage whole", () => {
    const { findings } = run([entry("commission.commission_pct", 8, "The agency commission is eight percent (8%) of room revenue.")]);
    expect(findings[0].proposed_language).toBe("The agency commission is ten percent (10%) of room revenue.");
  });

  it("stays out when a finding already covers the number, by its words or by the number on that clause", () => {
    expect(run([COMMISSION], [modelFinding("general", COMMISSION.quoted_text)]).findings).toEqual([]);
    expect(run([COMMISSION], [modelFinding("commission", "a commission of 8% of the Group Room Rate")]).findings).toEqual([]);

    // A finding on the clause that never touches the rate doesn't cover it.
    expect(run([COMMISSION], [modelFinding("commission", "once your master account has been paid in full")]).findings).toHaveLength(1);
  });

  it("raises nothing when the number meets the standard, or wasn't verified", () => {
    expect(run([entry("commission.commission_pct", 10, "Hotel pays ten percent (10%) commission.")]).findings).toEqual([]);
    expect(run([entry("commission.commission_pct", 6, "The agency commission is eight percent (8%) of room revenue.")]).findings).toEqual([]);
  });

  it("raises an attrition floor above 70% of the block, with the minimum changed to 70%", () => {
    const { findings } = run([BLOCK, MINIMUM]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      clause_type: "attrition",
      headline: "Attrition floor is 78.6% of the block, above the 70% standard",
      proposed_language: "You agree that you will use at least 2,030 room nights at the Hotel.",
    });
  });

  it("raises a percentage threshold when the contract gives no count", () => {
    const { findings } = run([entry("attrition.threshold", 90, "Damages apply when pickup falls below the attrition threshold of ninety percent (90%).")]);
    expect(findings[0]).toMatchObject({
      clause_type: "attrition",
      proposed_language: "Damages apply when pickup falls below the attrition threshold of seventy percent (70%).",
    });
  });

  it("raises a food and beverage shortfall rate above 35%", () => {
    const { findings } = run([entry("fb_minimum.shortfall_rate", 100, "The shortfall payment rate shall be one hundred percent (100%) of the difference.")]);
    expect(findings[0]).toMatchObject({
      clause_type: "fb_minimum",
      proposed_language: "The shortfall payment rate shall be thirty-five percent (35%) of the difference.",
    });
  });

  it("writes no wording when the number sits in the sentence twice, and says the number is uncovered", () => {
    const { findings, uncovered } = run([entry("commission.commission_pct", 8, "A fee of 8% applies, and a second fee of 8% applies after that.")]);
    expect(findings).toEqual([]);
    expect(uncovered).toEqual([{ clause_type: "commission", headline: "Commission is 8%, below the 10% standard" }]);
  });
});
