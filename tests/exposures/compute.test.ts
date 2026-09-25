import { describe, expect, it } from "vitest";
import { attritionExposure, cancellationExposure, fbMinimumExposure, withComputedExposures } from "@/lib/exposures/compute";
import { NO_FIGURES, type DealFigures } from "@/lib/exposures/figures";
import type { Finding } from "@/lib/anthropic";

/**
 * Exposure figures the app works out from a contract's checked figures.
 *
 * The figures match a real resort contract: 2,850 room nights, a 2,280-night
 * minimum, $149 a night, attrition at 80% of the rate, and cancellation up to
 * 90% of the full rate. A run whose model wrote its own formulas got $139,285
 * for cancellation, applying 70% twice. The right gap is $91,724.40.
 */

const FLORIDA: DealFigures = {
  ...NO_FIGURES,
  room_block_room_nights: 2850,
  group_rate_usd: 149,
  minimum_room_nights: 2280,
  attrition_damages_pct: 0.8,
  cancellation_tiers: [
    { label: "731 Days or More", room_pct: 0.05, base: "minimum_room_nights", charges: "rate" },
    { label: "90 Days or Less", room_pct: 0.9, base: "minimum_room_nights", charges: "rate" },
    { label: "91 - 180 Days", room_pct: 0.75, base: "minimum_room_nights", charges: "rate" },
  ],
  fb_minimum_usd: 100000,
};

describe("attritionExposure", () => {
  it("charges the nights between the contract's minimum and CD's 70% trigger", () => {
    expect(attritionExposure(FLORIDA)).toEqual({
      amount: 33972,
      formula: "(2280 - 1995) * $149 * 0.8",
      basis:
        "At 70% pickup (1,995 room nights), where CD's standard owes nothing, this contract charges for 285 nights at 80% of $149.",
    });
  });

  it("reads a commitment stated as a share of the block", () => {
    expect(attritionExposure({ ...FLORIDA, minimum_room_nights: null, attrition_threshold_pct: 0.8 })?.amount).toBe(33972);
  });

  it("gives no figure when the contract's minimum is at or below CD's trigger", () => {
    expect(attritionExposure({ ...FLORIDA, minimum_room_nights: 1995 })).toBeNull();
  });

  it("gives no figure without every figure it needs", () => {
    expect(attritionExposure({ ...FLORIDA, attrition_damages_pct: null })).toBeNull();
  });
});

describe("cancellationExposure", () => {
  it("takes the tier with the highest fee, and charges its share of profit instead of the full rate", () => {
    expect(cancellationExposure(FLORIDA)).toEqual({
      amount: 91724.4,
      formula: "2280 * $149 * 0.9 * (1 - 0.7)",
      basis:
        'In the "90 Days or Less" tier, this contract charges 90% of the full rate on 2,280 room nights. CD\'s standard charges 90% of room profit, which is 70% of the rate.',
    });
  });

  it("gives no figure when the contract already charges room profit, or names another base", () => {
    const tier = FLORIDA.cancellation_tiers[1];
    expect(cancellationExposure({ ...FLORIDA, cancellation_tiers: [{ ...tier, charges: "room_profit" }] })).toBeNull();
    expect(cancellationExposure({ ...FLORIDA, cancellation_tiers: [{ ...tier, base: "other" }] })).toBeNull();
  });
});

describe("fbMinimumExposure", () => {
  it("gives no figure when the contract states no shortfall rate", () => {
    expect(fbMinimumExposure(FLORIDA)).toBeNull();
  });

  it("compares a stated shortfall rate with CD's 35%", () => {
    expect(fbMinimumExposure({ ...FLORIDA, fb_shortfall_pct: 1 })?.amount).toBe(65000);
  });
});

describe("withComputedExposures", () => {
  const finding = (clause_type: string): Finding => ({
    clause_type,
    is_missing_clause: false,
    severity: "high",
    location_section: null,
    quoted_text: "Quoted.",
    exposure_amount: 999,
    exposure_basis: "The model's own.",
    exposure_formula: "999",
    finding_text: "Why.",
    cd_standard: "Standard.",
    proposed_language: "Wording.",
    model_confidence: "high",
  });

  it("puts each figure on the first finding of its clause, and clears every other", () => {
    const out = withComputedExposures(
      [finding("cancellation"), finding("cancellation"), finding("attrition"), finding("commission")],
      FLORIDA
    );
    expect(out.map((f) => f.exposure_amount)).toEqual([91724.4, null, 33972, null]);
    expect(out[3]).toMatchObject({ exposure_basis: null, exposure_formula: null });
  });
});
