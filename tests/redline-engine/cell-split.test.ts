import { describe, expect, it } from "vitest";
import { splitAcrossCells } from "@/lib/redline-engine/cell-split";

/**
 * Laying a proposal written without "|" back out across table cells. The
 * schedule wording here is invented.
 */

describe("splitAcrossCells", () => {
  it("puts a change inside one cell into that cell", () => {
    expect(splitAcrossCells(["Tier A", "fifty percent (50%)"], "Tier A twenty-five percent (25%)")).toEqual([
      "Tier A",
      "twenty-five percent (25%)",
    ]);
  });

  it("puts changes in two cells into each", () => {
    expect(
      splitAcrossCells(
        ["Days 90 to 180 before arrival", "fifty percent (50%) of room revenue", "twenty percent (20%) of the minimum"],
        "Days 90 to 180 before arrival thirty-five percent (35%) of room revenue ten percent (10%) of the minimum"
      )
    ).toEqual([
      "Days 90 to 180 before arrival",
      "thirty-five percent (35%) of room revenue",
      "ten percent (10%) of the minimum",
    ]);
  });

  it("refuses a change that crosses from one cell into the next", () => {
    expect(
      splitAcrossCells(["Days 90 to 180 before arrival", "fifty percent (50%) of room revenue"], "Days 90 to 180 before arrival and fifty percent (50%) of room revenue")
    ).toBeNull();
  });

  it("refuses wording inserted on the line between two cells", () => {
    expect(
      splitAcrossCells(
        ["Days 90 to 180 before arrival", "fifty percent (50%) of room revenue"],
        "Days 90 to 180 before arrival in writing fifty percent (50%) of room revenue"
      )
    ).toBeNull();
  });

  it("keeps a changed last word in its own cell", () => {
    expect(
      splitAcrossCells(
        ["Days 90 to 180 before arrival", "fifty percent (50%) of room revenue"],
        "Days 90 to 180 before arrival, in writing, fifty percent (50%) of room revenue"
      )
    ).toEqual(["Days 90 to 180 before arrival, in writing,", "fifty percent (50%) of room revenue"]);
  });

  it("refuses a rewrite", () => {
    expect(splitAcrossCells(["Tier A", "fifty percent (50%)"], "Fees are seventy percent of room profit.")).toBeNull();
  });

  it("returns a single cell's proposal as it is", () => {
    expect(splitAcrossCells(["fifty percent (50%)"], "twenty-five percent (25%)")).toEqual(["twenty-five percent (25%)"]);
  });
});
