import { describe, expect, it } from "vitest";
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
  { key: "hilton", name: "Hilton", brand_names: ["Hilton"], is_default: false },
  { key: "hyatt", name: "Hyatt", brand_names: ["Hyatt"], is_default: false },
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
  it("takes a brand in the property name", () => {
    const read = readBrand("Rooms are held at the group rate.", "Hilton Sampleville Downtown", SETS);
    expect(read).toMatchObject({ set: "hilton", evidence: "Hilton Sampleville Downtown", note: null });
  });

  it("takes a sub-brand that carries the family name", () => {
    expect(readBrand("", "DoubleTree by Hilton Sampleville", SETS).set).toBe("hilton");
    expect(readBrand("", "Hyatt Regency Sampleville", SETS).set).toBe("hyatt");
  });

  it("takes the only brand the contract names, with the sentence it sits in", () => {
    const text = "Group Sales Agreement.\nReservations may be made through Hyatt central reservations at any time.\nRates are net.";
    expect(readBrand(text, "Sampleville Grand", SETS)).toEqual({
      set: "hyatt",
      evidence: "Reservations may be made through Hyatt central reservations at any time.",
      note: null,
    });
  });

  it("counts a brand in an email address or in lower case", () => {
    expect(readBrand("Send rooming lists to groups@hilton.com before the cutoff.", null, SETS).set).toBe("hilton");
  });

  it("ignores Hilton Head, which is a place", () => {
    expect(readBrand("The hotel is located on Hilton Head Island, South Carolina.", "Palmetto Dunes Resort", SETS)).toEqual({
      set: null,
      evidence: null,
      note: null,
    });
  });

  it("ignores a brand named only in a comparison", () => {
    const walk = "If we cannot accommodate a guest, we will provide a room at a comparable hotel such as a Hyatt nearby.";
    expect(readBrand(walk, "Sampleville Grand", SETS).set).toBeNull();
    expect(readBrand(`${walk}\nThis Hilton hotel will hold the block.`, "Sampleville Grand", SETS).set).toBe("hilton");
  });

  it("gives no set when two brands are named, and says so", () => {
    const text = "Points are earned under Hilton Honors.\nWorld of Hyatt members receive their benefits.";
    expect(readBrand(text, "Sampleville Grand", SETS)).toEqual({
      set: null,
      evidence: null,
      note: "This contract names both Hilton and Hyatt, so choose the standards yourself.",
    });
  });

  it("lets the property name settle it when the body names another brand too", () => {
    const text = "World of Hyatt members receive their benefits.";
    expect(readBrand(text, "Hilton Sampleville", SETS).set).toBe("hilton");
  });

  it("gives no set for a hotel of no listed brand", () => {
    expect(readBrand("Rooms are held at the group rate.", "Harborview Grand Hotel", SETS)).toEqual({ set: null, evidence: null, note: null });
  });

  it("doesn't match a brand inside another word", () => {
    expect(readBrand("The Chilton Room seats forty.", "Sampleville Grand", SETS).set).toBeNull();
  });

  it("never returns the default set as a brand", () => {
    expect(readBrand("An independent hotel.", "Independent Inn", SETS).set).toBeNull();
  });
});
