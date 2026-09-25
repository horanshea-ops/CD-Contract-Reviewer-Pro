import { describe, expect, it } from "vitest";
import { checkExposure, evaluateFormula, formatCalculation } from "@/lib/exposure";
import { formatCurrency } from "@/lib/format";

/**
 * Exposure figures the app works out from the model's formula.
 *
 * A real review showed $91,200 for attrition beside its own working of
 * 2280 * 149 * 0.10, which is $33,972.
 */

describe("evaluateFormula", () => {
  it("does the arithmetic the model got wrong", () => {
    expect(evaluateFormula("2280 * 149 * 0.10")).toBeCloseTo(33972, 6);
  });

  it("follows precedence and parentheses", () => {
    expect(evaluateFormula("2 + 3 * 4")).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4")).toBe(20);
    expect(evaluateFormula("2280 * 149 * (0.90 - 0.70 * 0.90)")).toBeCloseTo(91724.4, 6);
  });

  it("reads commas, dollar signs, percents and the symbols a person would write", () => {
    expect(evaluateFormula("$2,280 × 149 × 10%")).toBeCloseTo(33972, 6);
    expect(evaluateFormula("100,000 ÷ 2 − 5,000")).toBe(45000);
  });

  it("refuses anything that isn't plain arithmetic", () => {
    for (const bad of ["", "2280 * rate", "process.exit()", "2 +", "(2 + 3", "2 / 0", "1e9 * 2"]) {
      expect(evaluateFormula(bad), bad).toBeNull();
    }
  });
});

describe("checkExposure", () => {
  it("replaces the model's figure with the formula's result", () => {
    expect(checkExposure({ exposure_amount: 91200, exposure_formula: "2280 * 149 * 0.10" })).toEqual({
      exposure_amount: 33972,
      exposure_formula: "2280 * 149 * 0.10",
      model_amount_disagreed: 91200,
    });
  });

  it("shows no figure without a formula that works", () => {
    expect(checkExposure({ exposure_amount: 50000 }).exposure_amount).toBeNull();
    expect(checkExposure({ exposure_amount: 50000, exposure_formula: "about fifty thousand" })).toMatchObject({
      exposure_amount: null,
      exposure_formula: null,
    });
  });

  it("rounds to the cent and records no disagreement when the model was right", () => {
    expect(checkExposure({ exposure_amount: 214023.6, exposure_formula: "2280 * 149 * 0.70 * 0.90" })).toEqual({
      exposure_amount: 214023.6,
      exposure_formula: "2280 * 149 * 0.70 * 0.90",
      model_amount_disagreed: null,
    });
  });
});

describe("formatCalculation", () => {
  it("writes a formula for a reader", () => {
    expect(formatCalculation("2280 * 149 * 0.10", 33972)).toBe("2,280 × 149 × 10% = $33,972");
  });

  it("keeps dollar signs and parentheses, and shows percents as written", () => {
    expect(formatCalculation("$100,000 * (80% - 35%)", 45000)).toBe("$100,000 × (80% − 35%) = $45,000");
  });

  it("writes a euro formula in euros", () => {
    expect(evaluateFormula("€20000 * (1 - 0.35)")).toBe(13000);
    expect(formatCalculation("€20000 * (1 - 0.35)", 13000)).toBe("€20,000 × (1 − 35%) = €13,000");
  });
});

describe("formatCurrency", () => {
  it("shows whole dollars with commas", () => {
    expect(formatCurrency(93646.8)).toBe("$93,647");
    expect(formatCurrency(33972)).toBe("$33,972");
  });
});
