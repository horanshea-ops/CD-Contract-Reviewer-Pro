import { describe, expect, it } from "vitest";
import { leadingNumber, outlineOf, sectionAt, sectionTitle } from "@/lib/contract-outline";

/**
 * The section outline §1.5 disambiguates with and §2.1.1 maps changed regions
 * onto. Both depend on the same property: a section's range must cover exactly
 * the text under it and nothing after. A range that runs long attributes a
 * change to the clause above it, which is the quiet failure this module exists
 * to avoid.
 */

const CONTRACT = [
  "This agreement is made between Hotel and Group.",
  "",
  "# 1. Room Block",
  "",
  "Group shall reserve eighty (80) rooms.",
  "",
  "## 1.2 Cutoff Date",
  "",
  "Rooms release thirty (30) days before arrival.",
  "",
  "2. Attrition",
  "",
  "Group shall pay eighty percent (80%) of the shortfall.",
].join("\n");

describe("outlineOf", () => {
  it("reads both heading marks and bare clause numbers", () => {
    const sections = outlineOf(CONTRACT);
    expect(sections.map((s) => s.number)).toEqual(["1", "1.2", "2"]);
    expect(sections.map((s) => s.label)).toEqual(["1. Room Block", "1.2 Cutoff Date", "Attrition"]);
  });

  it("reports depth from the marker, not from document order", () => {
    expect(outlineOf(CONTRACT).map((s) => s.depth)).toEqual([1, 2, 1]);
  });

  it("gives each section a range ending where the next one starts", () => {
    const sections = outlineOf(CONTRACT);
    for (let i = 0; i < sections.length - 1; i++) {
      expect(sections[i].end).toBe(sections[i + 1].start);
    }
    expect(sections[sections.length - 1].end).toBe(CONTRACT.length);
  });

  it("returns them in document order whichever marker found them", () => {
    const sections = outlineOf(CONTRACT);
    const starts = sections.map((s) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("finds nothing in a contract with no headings at all", () => {
    expect(outlineOf("A block of prose with a 2 in it and $50,000 of exposure.")).toEqual([]);
  });

  it("ignores a number that is not the start of a clause", () => {
    // "within 30 days" opens no section; only a line-leading number does.
    expect(outlineOf("Payment is due within 30. days of invoice.")).toEqual([]);
  });
});

describe("sectionTitle", () => {
  it("drops a number the heading already carries", () => {
    const [roomBlock, cutoff] = outlineOf(CONTRACT);
    expect(sectionTitle(roomBlock)).toBe("Room Block");
    expect(sectionTitle(cutoff)).toBe("Cutoff Date");
  });

  it("leaves an unnumbered heading alone", () => {
    expect(sectionTitle(outlineOf("# Force Majeure\n\nText.")[0])).toBe("Force Majeure");
  });

  it("keeps the label when stripping would leave nothing", () => {
    expect(sectionTitle(outlineOf("## 4.1\n\nText.")[0])).toBe("4.1");
  });
});

describe("sectionAt", () => {
  const sections = outlineOf(CONTRACT);

  it("places an offset in the section it falls under", () => {
    const attrition = CONTRACT.indexOf("eighty percent");
    expect(sectionAt(sections, attrition)?.number).toBe("2");

    const cutoff = CONTRACT.indexOf("thirty (30) days");
    expect(sectionAt(sections, cutoff)?.number).toBe("1.2");
  });

  it("puts a preamble above the first heading in no section", () => {
    expect(sectionAt(sections, 5)).toBeNull();
  });

  it("counts the heading line itself as part of its own section", () => {
    expect(sectionAt(sections, CONTRACT.indexOf("# 1. Room Block"))?.number).toBe("1");
  });

  it("answers null for an outline with no sections", () => {
    expect(sectionAt([], 0)).toBeNull();
  });
});

describe("leadingNumber", () => {
  it("reads the number a section reference opens with", () => {
    expect(leadingNumber("5.2 Attrition")).toBe("5.2");
    expect(leadingNumber("  12 ")).toBe("12");
    expect(leadingNumber("Attrition")).toBeNull();
  });
});
