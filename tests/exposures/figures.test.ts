import { describe, expect, it } from "vitest";
import { checkFigures } from "@/lib/exposures/figures";

/**
 * The contract's figures, kept only when their quotes bear them out. The
 * wording is invented.
 */

const CONTRACT = [
  "Run of House: $149.00 per night.",
  "You agree that you will use at least 2,280 room nights.",
  "The attrition fee is the shortfall times the rate times eighty percent (80%).",
  "90 Days or Less: $305,748.00 [the Minimum Number of Room Nights, times the Group Room Rate, times 90%]",
].join("\n");
const parts = [{ part: "document", text: CONTRACT }];

describe("checkFigures", () => {
  it("keeps figures whose quotes are in the contract and state them", () => {
    const out = checkFigures(
      {
        group_rate_usd: { value: 149, quoted_text: "Run of House: $149.00 per night." },
        minimum_room_nights: { value: 2280, quoted_text: "at least 2,280 room nights" },
        attrition_damages_pct: { value: 80, quoted_text: "times eighty percent (80%)" },
        cancellation_tiers: [
          {
            label: "90 Days or Less",
            room_pct: 90,
            base: "minimum_room_nights",
            charges: "rate",
            quoted_text: "the Minimum Number of Room Nights, times the Group Room Rate, times 90%",
          },
        ],
      },
      parts
    );
    expect(out).toMatchObject({
      group_rate_usd: 149,
      minimum_room_nights: 2280,
      attrition_damages_pct: 0.8,
      cancellation_tiers: [{ label: "90 Days or Less", room_pct: 0.9, base: "minimum_room_nights", charges: "rate" }],
    });
  });

  it("drops a figure its quote contradicts, or whose quote isn't in the contract", () => {
    const out = checkFigures(
      {
        minimum_room_nights: { value: 2850, quoted_text: "at least 2,280 room nights" },
        group_rate_usd: { value: 149, quoted_text: "Run of House: $149.00 per room" },
        attrition_damages_pct: { value: 0.8, quoted_text: "times eighty percent (80%)" },
      },
      parts
    );
    expect(out).toMatchObject({ minimum_room_nights: null, group_rate_usd: null, attrition_damages_pct: null });
  });

  it("gives no figures for anything that isn't an object", () => {
    expect(checkFigures(null, parts).cancellation_tiers).toEqual([]);
    expect(checkFigures("{}", parts).group_rate_usd).toBeNull();
  });
});
