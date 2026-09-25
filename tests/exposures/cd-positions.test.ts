import { describe, expect, it } from "vitest";
import {
  ATTRITION_DAMAGES_OF_RATE,
  ATTRITION_TRIGGER_OF_BLOCK,
  FB_SHORTFALL_RATE,
  ROOM_PROFIT_OF_RATE,
} from "@/lib/exposures/cd-positions";
import { STANDARDS_LIBRARY } from "@/lib/standards/v1";

/**
 * The exposure calculations use CD's positions as numbers. If the standards
 * library changes one, these fail rather than the figures going stale.
 */

const position = (clauseType: string) => {
  const entry = STANDARDS_LIBRARY.find((s) => s.clause_type === clauseType);
  if (!entry) throw new Error(`No ${clauseType} standard.`);
  return `${entry.position} ${entry.fallback_language}`;
};
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

describe("CD's positions as the calculations use them", () => {
  it("match the attrition standard's trigger and damages", () => {
    expect(position("attrition")).toContain(`below ${pct(ATTRITION_TRIGGER_OF_BLOCK)} of the block`);
    expect(position("attrition")).toContain(`Damages should be ${pct(ATTRITION_DAMAGES_OF_RATE)} lost profit`);
  });

  it("match the cancellation standard's room profit", () => {
    expect(position("cancellation")).toContain(`${pct(ROOM_PROFIT_OF_RATE)} of the single net group rate`);
  });

  it("match the food and beverage shortfall rate", () => {
    expect(position("fb_minimum")).toContain(pct(FB_SHORTFALL_RATE));
  });
});
