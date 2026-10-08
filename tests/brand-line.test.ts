import { describe, expect, it } from "vitest";
import { brandLine, type BrandLineSet } from "@/lib/intake/brand-line";

/**
 * The line under the brand on the new-review form. It says which standards a
 * review will use before the associate starts it.
 */

const SETS: BrandLineSet[] = [
  { key: "independent", name: "Independent", brand_names: [], is_default: true, in_use: true },
  { key: "hilton", name: "Hilton", brand_names: ["Hilton"], is_default: false, in_use: true },
  { key: "hyatt", name: "Hyatt", brand_names: ["Hyatt"], is_default: false, in_use: false },
];

const read = (brand: string | null, evidence: string | null = null, note: string | null = null) => ({ brand, set: null, evidence, note });

describe("the line under the brand", () => {
  it("names the family's standards when they are switched on", () => {
    expect(brandLine(null, SETS, "Hilton")).toBe("This review will use Hilton's standards.");
  });

  it("says a family's standards aren't switched on yet", () => {
    expect(brandLine(null, SETS, "Hyatt")).toBe("Hyatt's standards aren't switched on yet, so this review will use Independent's.");
  });

  it("says a brand has no standards of its own, and that the review runs against Independent's", () => {
    const line = "There are no specific standards for this brand, so this review will run against Independent's standards.";
    expect(brandLine(null, SETS, "Marriott")).toBe(line);
    expect(brandLine(null, SETS, "Graduate Hotels")).toBe(line);
  });

  it("takes Independent as the brand of a hotel that has none", () => {
    expect(brandLine(null, SETS, "Independent")).toBe("This review will use Independent's standards.");
    expect(brandLine(null, SETS, " independent ")).toBe("This review will use Independent's standards.");
  });

  it("says which family a typed line belongs to", () => {
    expect(brandLine(null, SETS, "Hilton Garden Inn")).toBe("Hilton Garden Inn is a Hilton brand. This review will use Hilton's standards.");
    expect(brandLine(null, SETS, "Andaz")).toBe("Andaz is a Hyatt brand. Hyatt's standards aren't switched on yet, so this review will use Independent's.");
    expect(brandLine(null, SETS, "Sheraton")).toBe(
      "Sheraton is a Marriott brand. There are no specific standards for this brand, so this review will run against Independent's standards."
    );
    expect(brandLine(null, SETS, "Holiday Inn")).toMatch(/^Holiday Inn is an IHG brand\./);
  });

  it("quotes the contract when the brand is the one it read there", () => {
    expect(brandLine(read("Hyatt", "Hyatt Regency Sampleville"), SETS, "Hyatt")).toBe(
      "From the contract: “Hyatt Regency Sampleville” Hyatt's standards aren't switched on yet, so this review will use Independent's."
    );
  });

  it("asks for a brand when there is none, and never names standards for a blank", () => {
    expect(brandLine(null, SETS, "")).toBe("Enter the hotel's brand, or Independent if it has none.");
    expect(brandLine(read(null), SETS, "  ")).toBe("No brand found in the contract. Enter the hotel's brand, or Independent if it has none.");
    expect(brandLine(read(null, null, "This contract names both Hilton and Hyatt, so enter the brand yourself."), SETS, "")).toBe(
      "This contract names both Hilton and Hyatt, so enter the brand yourself."
    );
  });

  it("says nothing when the sets couldn't be read", () => {
    expect(brandLine(null, [], "Hilton")).toBeNull();
  });
});
