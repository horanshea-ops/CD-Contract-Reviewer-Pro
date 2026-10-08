import { describe, expect, it } from "vitest";
import { setForBrand, placeBrand } from "@/lib/intake/brands";
import { HILTON_BRANDS, HYATT_BRANDS } from "./helpers/brand-lists";
import { readBrand, readPropertyName } from "@/lib/intake/read";

/**
 * Reading the property name and the brand off a contract at upload, by local
 * rules alone (user's decision, 2026-10-07). No model is called.
 *
 * The associate confirms both before a review starts, so a miss costs a few
 * keystrokes. A wrong guess that gets confirmed sends the contract to the
 * wrong standards, so the rules give nothing when they aren't sure, and every
 * guess carries the wording it came from.
 *
 * The layouts are the three on file, with invented names.
 */

const SETS = [
  { key: "independent", name: "Independent", brand_names: [], is_default: true },
  { key: "hilton", name: "Hilton", brand_names: HILTON_BRANDS, is_default: false },
  { key: "hyatt", name: "Hyatt", brand_names: HYATT_BRANDS, is_default: false },
];

describe("the property name", () => {
  it("reads a labelled table row", () => {
    const text = "# GENERAL INFORMATION\n| Organization:  | Coastal Engineers  |\n| Hotel:  | Seaside Grand Resort  |\n| Meeting Dates:  | April 12-16  |";
    expect(readPropertyName(text)).toEqual({ value: "Seaside Grand Resort", evidence: "Hotel: Seaside Grand Resort" });
  });

  it("reads a labelled cell with other labels around it", () => {
    const text =
      '| ▪ Client Name: Coastal Engineers ("You" or "Client") VAT   | Hotel Owner Name: Lakeside Holdings S.p.A., currently trading as Hotel Name: Lakeside Palace (collectively, "Hotel" or "we") Fiscal Code :   |\n' +
      "| Client Mailing Address:  | 1 Main St  | Hotel Address:  | 2 Via Roma  |\n| Client Contact Name:  | A. Person  | Hotel Contact Name:  | B. Person  |";
    expect(readPropertyName(text)?.value).toBe("Lakeside Palace");
  });

  it("reads the party sentence, and leaves the address out", () => {
    const text =
      '# GROUP SALES AGREEMENT\nThis Group Sales Agreement is entered into between Harborview Grand Hotel, located in Baltimore, Maryland (the "Hotel"), and National Association of Coastal Engineers (the "Group"), for the event to be held April 12-16, 2027.';
    expect(readPropertyName(text)?.value).toBe("Harborview Grand Hotel");
  });

  it("reads the hotel when the group is named first", () => {
    const text =
      'This Agreement is made between National Association of Coastal Engineers, a Delaware corporation (the "Group"), and Seaside Hotel and Spa, located in Tampa, Florida (the "Hotel").';
    expect(readPropertyName(text)?.value).toBe("Seaside Hotel and Spa");
  });

  it("reads a defined term with no 'the'", () => {
    expect(readPropertyName('This agreement is between Acme Association ("Group") and Monarch Plaza New York ("Hotel").')?.value).toBe(
      "Monarch Plaza New York"
    );
  });

  it("reads a labelled line in plain text, as a PDF gives it", () => {
    expect(readPropertyName("GROUP SALES AGREEMENT\nHotel Name: Granite Bay Lodge\nGroup: Acme Association")?.value).toBe("Granite Bay Lodge");
  });

  it("keeps a redacted name as written, since that is what the contract says", () => {
    expect(readPropertyName("| Hotel:  | Redacted's Resort  |")?.value).toBe("Redacted's Resort");
  });

  it("gives nothing for a role word on its own", () => {
    expect(readPropertyName('The parties are the Hotel (the "Hotel") and the Group (the "Group").')).toBeNull();
    expect(readPropertyName("| Hotel:  |   |\n| Group:  | Acme  |")).toBeNull();
  });

  it("gives nothing when the contract never names the hotel", () => {
    expect(readPropertyName("# 1. Room Block\nHotel will hold a block of 340 rooms.\nNotices to Hotel: 2 Main Street.")).toBeNull();
  });

  it("gives nothing for a run of words too long to be a name", () => {
    const long = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(readPropertyName(`| Hotel:  | ${long}  |`)).toBeNull();
  });

  it("looks only at the opening of the contract", () => {
    const filler = "Room rates are net and non-commissionable.\n".repeat(400);
    expect(readPropertyName(`${filler}| Hotel:  | Buried Name Inn  |`)).toBeNull();
  });
});

describe("the brand", () => {
  it("takes a brand in the property name, with its standards set", () => {
    expect(readBrand("Rooms are held at the group rate.", "Hilton Sampleville Downtown", SETS)).toEqual({
      brand: "Hilton",
      set: "hilton",
      evidence: "Hilton Sampleville Downtown",
      note: null,
    });
  });

  it("names a listed brand by its set, since a set's brands share one set of standards", () => {
    expect(readBrand("", "DoubleTree by Hilton Sampleville", SETS)).toMatchObject({ brand: "Hilton", set: "hilton", evidence: "DoubleTree by Hilton Sampleville" });
    expect(readBrand("", "Hilton Garden Inn Sampleville", SETS)).toMatchObject({ brand: "Hilton", set: "hilton" });
    expect(readBrand("", "Hyatt Regency Sampleville", SETS)).toMatchObject({ brand: "Hyatt", set: "hyatt" });
  });

  it("names a brand that has no standards of its own, and gives it no set", () => {
    expect(readBrand("", "Sampleville Marriott Marquis", SETS)).toMatchObject({ brand: "Marriott", set: null, note: null });
    expect(readBrand("", "The Westin Sampleville", SETS)).toMatchObject({ brand: "Marriott", set: null });
    expect(readBrand("", "Sheraton Sampleville", SETS)).toMatchObject({ brand: "Marriott", set: null });
    expect(readBrand("", "Holiday Inn Sampleville", SETS)).toMatchObject({ brand: "IHG", set: null });
    expect(readBrand("", "Omni Sampleville Hotel", SETS)).toMatchObject({ brand: "Omni", set: null });
  });

  it("places a listed brand whose name doesn't carry the set's", () => {
    expect(readBrand("", "Conrad Sampleville", SETS)).toMatchObject({ brand: "Hilton", set: "hilton" });
    expect(readBrand("", "Andaz Sampleville", SETS)).toMatchObject({ brand: "Hyatt", set: "hyatt" });
  });

  it("takes the only brand the contract names, with the sentence it sits in", () => {
    const text = "Group Sales Agreement.\nReservations may be made through Hyatt central reservations at any time.\nRates are net.";
    expect(readBrand(text, "Sampleville Grand", SETS)).toEqual({
      brand: "Hyatt",
      set: "hyatt",
      evidence: "Reservations may be made through Hyatt central reservations at any time.",
      note: null,
    });
  });

  it("counts two names from one family as one brand", () => {
    const text = "Points are earned under Hilton Honors.\nThis DoubleTree by Hilton hotel will hold the block.";
    expect(readBrand(text, "Sampleville Grand", SETS)).toMatchObject({ brand: "Hilton", set: "hilton", note: null });
  });

  it("counts a brand in an email address or in lower case", () => {
    expect(readBrand("Send rooming lists to groups@hilton.com before the cutoff.", null, SETS)).toMatchObject({ brand: "Hilton", set: "hilton" });
  });

  it("ignores Hilton Head, which is a place", () => {
    expect(readBrand("The hotel is located on Hilton Head Island, South Carolina.", "Palmetto Dunes Resort", SETS)).toEqual({
      brand: null,
      set: null,
      evidence: null,
      note: null,
    });
  });

  it("ignores a brand named only in a comparison", () => {
    const walk = "If we cannot accommodate a guest, we will provide a room at a comparable hotel such as a Hyatt nearby.";
    expect(readBrand(walk, "Sampleville Grand", SETS).brand).toBeNull();
    expect(readBrand(`${walk}\nThis Hilton hotel will hold the block.`, "Sampleville Grand", SETS)).toMatchObject({ brand: "Hilton", set: "hilton" });
  });

  it("gives no brand when two families are named, and says so", () => {
    const text = "Points are earned under Hilton Honors.\nWorld of Hyatt members receive their benefits.";
    const read = readBrand(text, "Sampleville Grand", SETS);
    expect(read).toMatchObject({ brand: null, set: null, evidence: null });
    expect(read.note).toMatch(/^This contract names both (Hilton and Hyatt|Hyatt and Hilton), so enter the brand yourself\.$/);
  });

  it("lets the property name settle it when the body names another brand too", () => {
    expect(readBrand("World of Hyatt members receive their benefits.", "Hilton Sampleville", SETS)).toMatchObject({ brand: "Hilton", set: "hilton" });
  });

  it("doesn't read an everyday word as a brand in the body of the contract", () => {
    // Courtyard, Renaissance, Conrad and Omni are brands, and also ordinary words and names.
    const text = "The reception is in the courtyard. Mr. Conrad Smith signs for the Group. A Renaissance theme is planned.";
    expect(readBrand(text, "Sampleville Grand", SETS)).toEqual({ brand: null, set: null, evidence: null, note: null });
  });

  it("gives no brand for a hotel of no listed brand", () => {
    expect(readBrand("Rooms are held at the group rate.", "Harborview Grand Hotel", SETS)).toEqual({ brand: null, set: null, evidence: null, note: null });
  });

  it("doesn't match a brand inside another word", () => {
    expect(readBrand("The Chilton Room seats forty.", "Sampleville Grand", SETS).brand).toBeNull();
  });

  it("reads a set's own brand even when the built-in list doesn't have it", () => {
    const sets = [...SETS, { key: "kessler", name: "Kessler", brand_names: ["Kessler Collection"], is_default: false }];
    expect(readBrand("", "The Kessler Collection Sampleville", sets)).toMatchObject({ brand: "Kessler", set: "kessler" });
  });
});

describe("the standards a brand's reviews read", () => {
  it("is the set whose brand name the brand carries", () => {
    expect(setForBrand("Hilton", SETS)?.key).toBe("hilton");
    expect(setForBrand("DoubleTree by Hilton", SETS)?.key).toBe("hilton");
    expect(setForBrand("hyatt regency", SETS)?.key).toBe("hyatt");
  });

  it("is the set whose list holds the brand, whatever the brand is called", () => {
    for (const brand of ["Conrad", "Embassy Suites", "Hampton Inn", "Waldorf Astoria"]) expect(setForBrand(brand, SETS)?.key, brand).toBe("hilton");
    for (const brand of ["Andaz", "Thompson", "Alila", "Miraval"]) expect(setForBrand(brand, SETS)?.key, brand).toBe("hyatt");
  });

  it("counts two spellings of a brand as one", () => {
    // The list says "DoubleTree by Hilton" and "Canopy by Hilton".
    for (const brand of ["DoubleTree", "doubletree by hilton", "Canopy", "Hilton  Garden Inn"]) expect(setForBrand(brand, SETS)?.key, brand).toBe("hilton");
  });

  it("covers every brand on the two starting lists", () => {
    for (const brand of HILTON_BRANDS) expect(placeBrand(brand, SETS), brand).toMatchObject({ brand: "Hilton", set: { key: "hilton" } });
    for (const brand of HYATT_BRANDS) expect(placeBrand(brand, SETS), brand).toMatchObject({ brand: "Hyatt", set: { key: "hyatt" } });
  });

  it("is the default set for any other brand, a blank, or a place", () => {
    for (const brand of ["Marriott", "Sheraton", "Independent", "", null, "Hilton Head Resort", "Chilton Inn"]) {
      expect(setForBrand(brand, SETS), String(brand)).toBeNull();
    }
  });
});

describe("a set's list of brands, as an admin edits it", () => {
  const without = (brand: string) => SETS.map((set) => (set.key === "hilton" ? { ...set, brand_names: HILTON_BRANDS.filter((b) => b !== brand) } : set));

  it("sends a brand taken off its list to the default set, under its own name", () => {
    const sets = without("DoubleTree by Hilton");

    expect(placeBrand("DoubleTree", sets)).toMatchObject({ brand: "DoubleTree", set: null, leftOutOf: { key: "hilton" } });
    expect(readBrand("", "DoubleTree by Hilton Sampleville", sets)).toMatchObject({ brand: "DoubleTree by Hilton", set: null });

    // Every other Hilton brand is still Hilton's.
    expect(placeBrand("Conrad", sets)).toMatchObject({ brand: "Hilton", set: { key: "hilton" } });
    expect(placeBrand("Hilton", sets)).toMatchObject({ brand: "Hilton", set: { key: "hilton" } });
  });

  it("gives a brand placed under a set's name the same set when it is placed again", () => {
    for (const brand of ["Hyatt Regency", "Andaz", "Conrad", "Sheraton", "Graduate Hotels", "Independent"]) {
      const first = placeBrand(brand, SETS)!;
      expect(placeBrand(first.brand, SETS), brand).toMatchObject({ brand: first.brand, set: first.set });
    }
  });

  it("covers a brand an admin adds that the built-in list doesn't have, and reads it in a contract", () => {
    const sets = SETS.map((set) => (set.key === "hyatt" ? { ...set, brand_names: [...HYATT_BRANDS, "Hyatt Vivid", "Dream"] } : set));

    expect(placeBrand("Hyatt Vivid", sets)).toMatchObject({ brand: "Hyatt", set: { key: "hyatt" } });
    expect(readBrand("This Hyatt Vivid resort will hold the block.", "Sampleville Sands", sets)).toMatchObject({ brand: "Hyatt", set: "hyatt" });
  });

  it("reads a one-word brand an admin adds from the hotel's name, and never from the contract's text", () => {
    const sets = SETS.map((set) => (set.key === "hyatt" ? { ...set, brand_names: [...HYATT_BRANDS, "Dream"] } : set));

    expect(readBrand("", "Dream Sampleville", sets)).toMatchObject({ brand: "Hyatt", set: "hyatt" });
    expect(readBrand("We hope this will be a dream event for the Group.", "Sampleville Grand", sets).brand).toBeNull();
  });

  it("shows a brand of a family with no set as the family, as before", () => {
    expect(placeBrand("Sheraton", SETS)).toMatchObject({ brand: "Marriott", set: null, leftOutOf: null, written: "Sheraton" });
  });
});
