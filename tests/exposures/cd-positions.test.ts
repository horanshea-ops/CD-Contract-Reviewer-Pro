import { describe, expect, it } from "vitest";
import { attritionExposure, cancellationExposure, fbMinimumExposure } from "@/lib/exposures/compute";
import { DEFAULT_POSITIONS, POSITION_SOURCES, positionsFrom, readPosition } from "@/lib/exposures/cd-positions";
import { NO_FIGURES, type DealFigures } from "@/lib/exposures/figures";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";

/**
 * CD's numbers are read from the wording of its standards. These cases cover
 * the library as shipped, a number CD has changed, and wording the app can no
 * longer read a number from.
 */

const withPosition = (clauseType: string, change: (position: string) => string) =>
  STANDARDS_LIBRARY.map((s) => (s.clause_type === clauseType ? { ...s, position: change(s.position) } : s));

describe("CD's positions, read from the standards library", () => {
  it("reads all four numbers from the library as shipped", () => {
    expect(positionsFrom(STANDARDS_LIBRARY)).toEqual({
      positions: { attritionTrigger: 0.7, roomProfit: 0.7, fbShortfall: 0.35, commission: 0.1 },
      unread: [],
    });
    // The built-in values are what the shipped library says, so a fallback changes nothing until CD edits a standard.
    expect(positionsFrom(STANDARDS_LIBRARY).positions).toEqual(DEFAULT_POSITIONS);
  });

  it("follows a number CD changes in a standard's wording", () => {
    const edited = withPosition("commission", (p) => p.replace("10% commission", "12% commission"));
    expect(positionsFrom(edited)).toMatchObject({ positions: { commission: 0.12, attritionTrigger: 0.7 }, unread: [] });

    const looser = withPosition("attrition", (p) => p.replace("below 70% of the block", "below 75% of the block"));
    expect(positionsFrom(looser).positions.attritionTrigger).toBe(0.75);

    const half = withPosition("fb_minimum", (p) => p.replace("35% of the shortfall", "27.5% of the shortfall"));
    expect(positionsFrom(half).positions.fbShortfall).toBe(0.275);
  });

  it("keeps the built-in number and names it when the wording no longer states one", () => {
    const reworded = withPosition("commission", () => "The hotel should pay ConferenceDirect its standard commission.");
    expect(positionsFrom(reworded)).toEqual({ positions: DEFAULT_POSITIONS, unread: ["commission"] });

    const removed = STANDARDS_LIBRARY.filter((s) => s.clause_type !== "cancellation");
    expect(positionsFrom(removed).unread).toEqual(["roomProfit"]);
  });

  it("refuses a percentage that can't be a share", () => {
    const [commission] = POSITION_SOURCES.filter((s) => s.key === "commission");
    expect(readPosition(commission, "pay 0% commission")).toBeNull();
    expect(readPosition(commission, "pay 150% commission")).toBeNull();
    expect(readPosition(commission, "pay 8.5% commission")).toBe(0.085);
  });
});

describe("the exposures follow the library's numbers", () => {
  const FLORIDA: DealFigures = {
    ...NO_FIGURES,
    room_block_room_nights: 2900,
    group_rate: 149,
    minimum_room_nights: 2280,
    attrition_damages_pct: 0.8,
    cancellation_tiers: [{ label: "90 Days or Less", room_pct: 0.9, base: "minimum_room_nights", charges: "rate" }],
    fb_minimum: 80000,
    fb_shortfall_pct: 0.8,
    currency: "$",
  };

  it("gives today's amounts on today's library", () => {
    const { positions } = positionsFrom(STANDARDS_LIBRARY);
    expect(attritionExposure(FLORIDA, positions)?.amount).toBe(29800);
    expect(cancellationExposure(FLORIDA, positions)?.amount).toBe(91724.4);
    expect(fbMinimumExposure(FLORIDA, positions)?.amount).toBe(36000);
  });

  it("moves each amount when CD moves its standard", () => {
    const edited = withPosition("attrition", (p) => p.replace("below 70% of the block", "below 75% of the block"));
    // 75% of 2,900 is 2,175, so the gap to the contract's 2,280 is 105 nights.
    expect(attritionExposure(FLORIDA, positionsFrom(edited).positions)).toMatchObject({ amount: 12516, formula: "(2280 - 2175) * $149 * 0.8" });

    const profit = withPosition("cancellation", (p) => p.replace("70% of the single net group rate", "60% of the single net group rate"));
    expect(cancellationExposure(FLORIDA, positionsFrom(profit).positions)?.formula).toBe("2280 * $149 * 0.9 * (1 - 0.6)");

    const shortfall = withPosition("fb_minimum", (p) => p.replace("35% of the shortfall", "50% of the shortfall"));
    expect(fbMinimumExposure(FLORIDA, positionsFrom(shortfall).positions)?.amount).toBe(24000);
  });
});
