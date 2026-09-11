import { describe, it, expect } from "vitest";
import type { Finding } from "@/lib/anthropic";
import type { KeyItem, LanguageAssertion, LocationStatus } from "@/lib/eval/types";
import { gradePair, languageWasGraded } from "@/lib/eval/grade";
import { gradeLanguage } from "@/lib/eval/language";
import { numberToWords, phrase, parseQuantities } from "@/lib/quantities";

function keyItem(over: Partial<KeyItem> = {}): KeyItem {
  return {
    id: "k1",
    contract: "c.docx",
    kind: "present",
    clause_type: "attrition",
    severity: "high",
    anchors: [{ part: "document", start: 0, end: 10 }],
    anchor_texts: ["some text"],
    expected_language: [],
    exposure: { mode: "unspecified" },
    rationale: "",
    ...over,
  };
}

function finding(over: Partial<Finding> = {}): Finding {
  return {
    clause_type: "attrition",
    is_missing_clause: false,
    severity: "high",
    location_section: null,
    quoted_text: "some text",
    exposure_amount: null,
    exposure_basis: null,
    finding_text: "Too high.",
    cd_standard: "70%.",
    proposed_language: "Liability is capped at seventy percent (70%) of the group rate.",
    model_confidence: "high",
    ...over,
  };
}

const located: LocationStatus = {
  status: "located",
  span: { part: "document", start: 0, end: 10 },
  resolution: "exact",
};

describe("phrasing", () => {
  it("writes numbers the way a contract writes them", () => {
    expect(numberToWords(45)).toBe("forty-five");
    expect(numberToWords(90)).toBe("ninety");
    expect(numberToWords(100)).toBe("one hundred");
    expect(numberToWords(365)).toBe("three hundred sixty-five");
    expect(phrase(0.7, "pct")).toBe("seventy percent (70%)");
    expect(phrase(1, "pct")).toBe("one hundred percent (100%)");
    expect(phrase(30, "days")).toBe("thirty (30) days");
    expect(phrase(2500, "usd")).toBe("$2,500.00");
  });

  it("falls back to digits for a percentage that is not a whole number", () => {
    expect(phrase(0.015, "pct")).toBe("1.5%");
  });

  it("refuses a quantity outside the range a contract states in words", () => {
    expect(() => numberToWords(1000)).toThrow(/outside 0-999/);
    expect(() => numberToWords(-1)).toThrow();
  });

  it("reads quantities back out of prose, in either form", () => {
    const found = parseQuantities("Liability is seventy percent (70%) of a $2,500.00 fee within thirty (30) days.");
    expect(found.find((q) => q.unit === "pct")?.value).toBe(0.7);
    expect(found.find((q) => q.unit === "usd")?.value).toBe(2500);
    expect(found.find((q) => q.unit === "days")?.value).toBe(30);
  });

  it("reads a duration whether the digits are bare or in parentheses", () => {
    expect(parseQuantities("within thirty (30) days").map((q) => q.value)).toEqual([30]);
    expect(parseQuantities("within 30 days").map((q) => q.value)).toEqual([30]);
    expect(parseQuantities("twelve (12) months").map((q) => q.value)).toEqual([12]);
    expect(parseQuantities("seventy-two (72) hours").map((q) => q.value)).toEqual([72]);
  });

  it("does not read a spelled-out number with no digits beside it", () => {
    // Guessing at prose numerals would let the scorer credit a proposal whose
    // actual figure it never established.
    expect(parseQuantities("Liability is seventy percent of the rate.").map((q) => q.value)).toEqual([]);
  });
});

describe("gradeLanguage", () => {
  const bound: LanguageAssertion = {
    kind: "numeric_bound",
    label: "attrition threshold",
    unit: "pct",
    comparator: "lte",
    value: 0.7,
  };

  it("passes a replacement that puts a figure on CD's side of the line", () => {
    const grade = gradeLanguage([bound], "Liability applies below seventy percent (70%) pickup.", "ninety percent (90%)");
    expect(grade.passed).toBe(true);
    expect(grade.graded).toBe(true);
  });

  it("fails a replacement that keeps the offending figure", () => {
    const grade = gradeLanguage([bound], "Liability applies below ninety percent (90%) pickup.", null);
    expect(grade.passed).toBe(false);
    expect(grade.checks.find((c) => c.name.includes("attrition threshold"))!.detail).toContain("0.9");
  });

  it("fails a replacement that states no figure at all", () => {
    const grade = gradeLanguage([bound], "The threshold should be lowered.", null);
    expect(grade.checks.find((c) => c.name.includes("attrition threshold"))!.detail).toContain("no figure");
  });

  it("checks a phrase is present and an offending phrase is gone", () => {
    const assertions: LanguageAssertion[] = [
      { kind: "contains_phrase", phrase: "cumulative" },
      { kind: "absent_phrase", phrase: "night-by-night" },
    ];
    expect(gradeLanguage(assertions, "Attrition is measured cumulatively across the block.", null).passed).toBe(true);
    expect(gradeLanguage(assertions, "Cumulative, not night-by-night.", null).passed).toBe(false);
  });

  it("rejects an empty replacement, a placeholder, and a restatement", () => {
    expect(gradeLanguage([], "", null).checks.find((c) => c.name === "offers a replacement")!.passed).toBe(false);

    const placeholder = gradeLanguage([], "Rate for [Group Name] is reduced.", null);
    expect(placeholder.checks.find((c) => c.name.includes("placeholder"))!.passed).toBe(false);

    const restated = gradeLanguage([], "ninety percent (90%)", "ninety percent (90%)");
    expect(restated.checks.find((c) => c.name.includes("changes the wording"))!.passed).toBe(false);
  });

  it("counts a key item that asserts nothing as ungraded rather than as a pass", () => {
    // The universal checks are not a judgment about this clause's terms, so
    // counting them would inflate the language rate with pairs nobody checked.
    expect(gradeLanguage([], "Anything at all.", null).graded).toBe(false);
    expect(languageWasGraded(keyItem())).toBe(false);
    expect(languageWasGraded(keyItem({ expected_language: [bound] }))).toBe(true);
  });
});

describe("gradePair", () => {
  it("grades a finding that got everything right", () => {
    const grade = gradePair(keyItem(), finding(), located);
    expect(grade.clause_type).toBe("correct");
    expect(grade.presence).toBe("correct");
    expect(grade.severity).toEqual({ verdict: "exact", distance: 0 });
    expect(grade.quote).toBe("exact");
    expect(grade.exposure).toBe("not_applicable");
  });

  it("grades each dimension on its own", () => {
    // The right wording, the wrong clause name, and a severity two bands low.
    const grade = gradePair(keyItem(), finding({ clause_type: "cancellation", severity: "low" }), located);
    expect(grade.clause_type).toBe("wrong");
    expect(grade.quote).toBe("exact");
    expect(grade.severity.verdict).toBe("under_called");
    expect(grade.severity.distance).toBe(-2);
  });

  it("reports an over-called severity as positive distance", () => {
    const grade = gradePair(keyItem({ severity: "note" }), finding({ severity: "high" }), located);
    expect(grade.severity).toEqual({ verdict: "over_called", distance: 3 });
  });

  it("accepts a clause name the model wrote differently", () => {
    expect(gradePair(keyItem(), finding({ clause_type: "Attrition Clause" }), located).clause_type).toBe("correct");
  });

  it("grades presence in both directions", () => {
    expect(gradePair(keyItem(), finding({ is_missing_clause: true }), located).presence).toBe("wrong");
    expect(
      gradePair(keyItem({ kind: "absent", anchors: [] }), finding({ is_missing_clause: true }), {
        status: "no_quote",
      }).presence
    ).toBe("correct");
  });

  it("carries the quote verdict through from where the finding landed", () => {
    expect(gradePair(keyItem(), finding(), { status: "unlocatable", reason: "x" }).quote).toBe("unlocatable");
    expect(gradePair(keyItem(), finding(), { status: "ambiguous", reason: "x" }).quote).toBe("ambiguous");
    expect(gradePair(keyItem(), finding(), { status: "no_quote" }).quote).toBe("none");
    expect(
      gradePair(keyItem(), finding(), { ...located, resolution: "fuzzy" } as LocationStatus).quote
    ).toBe("fuzzy");
  });

  describe("exposure", () => {
    const required = keyItem({ exposure: { mode: "required", amount: 1000, tolerance: 0.25 } });
    const forbidden = keyItem({ exposure: { mode: "forbidden" } });

    it("accepts a figure inside tolerance and rejects one outside", () => {
      expect(gradePair(required, finding({ exposure_amount: 1100 }), located).exposure).toBe("correct");
      expect(gradePair(required, finding({ exposure_amount: 2000 }), located).exposure).toBe("out_of_tolerance");
    });

    it("reports a missing figure the contract could have supported", () => {
      expect(gradePair(required, finding(), located).exposure).toBe("omitted");
    });

    it("reports a figure on a clause carrying none as invented", () => {
      // The system prompt forbids estimating, so this is prompt non-compliance
      // rather than an arithmetic slip.
      expect(gradePair(forbidden, finding({ exposure_amount: 5000 }), located).exposure).toBe("invented");
      expect(gradePair(forbidden, finding(), located).exposure).toBe("correct");
    });

    it("takes no view where the key takes none", () => {
      expect(gradePair(keyItem(), finding({ exposure_amount: 12345 }), located).exposure).toBe("not_applicable");
    });
  });
});
