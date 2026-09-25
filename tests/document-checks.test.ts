import { describe, expect, it } from "vitest";
import { checkDocument } from "@/lib/document-checks";

/**
 * Arithmetic the app checks in the contract itself.
 *
 * Shaped like a real resort contract whose room block totals were off in
 * three places and whose suite night counts didn't match their dates. The
 * wording and figures here are invented.
 */

const BLOCK = [
  "# GUEST ROOMS",
  "",
  "| Day | Mon | Tue | Wed | Thu | Total |",
  "| --- | --- | --- | --- | --- | --- |",
  "| Date | 3/2 | 3/3 | 3/4 | 3/5 |   |",
  "| Standard | 40 | 90 | 120 | C/O | 250 |",
  "| Club Level | 0 | 10 | 10 | C/O | 30 |",
  "| Suites | 2 | 3 | 3 | C/O | 8 |",
  "| Total Block | 52 | 103 | 133 | C/O | 288 |",
].join("\n");

describe("table totals", () => {
  it("names each row and column that doesn't add up to its stated total", () => {
    expect(checkDocument(BLOCK)).toEqual([
      {
        source: "check",
        headline: "The Guest Rooms table's totals don't add up in 2 places.",
        detail: "Club Level adds up to 20, but its total says 30; Mon 3/2 adds up to 42, but the Total Block row says 52.",
      },
    ]);
  });

  it("says nothing when every total adds up", () => {
    expect(checkDocument(BLOCK.replace("| Club Level | 0 |", "| Club Level | 10 |"))).toEqual([]);
  });

  it("leaves tables with no total alone, such as a fee schedule or an agenda", () => {
    const schedule = [
      "# CANCELLATION",
      "| Days Before Arrival | Room Fee | F&B Fee |",
      "| --- | --- | --- |",
      "| 365 or more | $10,000.00 | $0 |",
      "| 90 or less | $50,000.00 | $20,000.00 |",
      "",
      "| day | time | Function | # of Guests |",
      "| --- | --- | --- | --- |",
      "| Monday | 8:00 am | Breakfast | 200 |",
      "|   | 12:00 pm | Lunch | 250 |",
    ].join("\n");
    expect(checkDocument(schedule)).toEqual([]);
  });

  it("reads figures with commas and dollar signs", () => {
    const money = ["| Item | Q1 | Q2 | Total |", "| --- | --- | --- | --- |", "| Rooms | $1,500 | $2,500 | $5,000 |"].join("\n");
    expect(checkDocument(money)[0].detail).toBe("Rooms adds up to 4,000, but its total says 5,000.");
  });
});

describe("night counts", () => {
  const stay = (count: string, arrive: string, depart: string) =>
    `The Hotel will provide one (1) Garden Suite for ${count} nights, arriving ${arrive} and departing ${depart}.`;

  it("notes a count that doesn't match its arrival and departure dates", () => {
    const notes = checkDocument(stay("five (5)", "Monday March 2, 2026", "Friday March 6, 2026"));
    expect(notes).toEqual([
      {
        source: "check",
        headline: "A booking's night count doesn't match its dates.",
        detail: 'One (1) Garden Suite for "five (5) nights", but March 2, 2026 to March 6, 2026 is 4 nights.',
      },
    ]);
  });

  it("reads dates that sit in the next sentence of the same paragraph", () => {
    const text =
      "The Hotel will provide two (2) Lake View suites for six (6) nights each. These suites are for arrival Sunday March 1, 2026 and departure Sunday March 8, 2026.";
    expect(checkDocument(text)[0].detail).toContain("March 1, 2026 to March 8, 2026 is 7 nights");
  });

  it("says nothing when the count matches", () => {
    expect(checkDocument(stay("four (4)", "Monday March 2, 2026", "Friday March 6, 2026"))).toEqual([]);
  });

  it("says nothing without both an arrival and a departure date", () => {
    expect(checkDocument("The Hotel will provide three (3) rooms for two (2) nights each for a planning visit.")).toEqual([]);
    expect(checkDocument("We will hold one (1) Garden Suite for five (5) nights beginning March 2, 2026.")).toEqual([]);
  });
});

describe("a summary table of labels and amounts", () => {
  // Shaped like a real revenue summary whose headline total was €5,000 more
  // than its parts. Line items there were also labelled "Total".
  const summary = (grand: string) =>
    [
      "# Revenue",
      "",
      "| Summary of Anticipated Revenue |",
      "| --- |",
      "| Total Anticipated Room Revenue | €90,000.00 |",
      "|   |   |",
      "| Minimum Food & Beverage Revenue | € 15,000.00 |",
      "| Total Meeting Room Rental | €6,000.00 |",
      `| Total Anticipated Revenue, excluding taxes | ${grand} |`,
      "| Taxes | €10,000.00 |",
      "| Total Anticipated Revenue, including taxes | €" + (Number(grand.replace(/[€,]/g, "")) + 10000).toLocaleString("en-US") + ".00 |",
    ].join("\n");

  it("names a total that its line items don't add up to", () => {
    expect(checkDocument(summary("€116,000.00"))).toEqual([
      {
        source: "check",
        headline: "The Revenue table's totals don't add up in one place.",
        detail: "Total Anticipated Revenue, excluding taxes adds up to 111,000 (90,000 + 15,000 + 6,000), but the table says 116,000.",
      },
    ]);
  });

  it("says nothing when every total adds up, including one built on the total above it", () => {
    expect(checkDocument(summary("€111,000.00"))).toEqual([]);
  });

  it("leaves a table with several amounts per row to the row and column check", () => {
    const schedule = ["| Notice | Rooms | Food |", "| --- | --- | --- |", "| 90 days | $5,000 | $1,000 |", "| 30 days | $9,000 | $2,000 |", "| Total due | $20,000 | $3,000 |"].join("\n");
    expect(checkDocument(schedule).map((n) => n.detail).join(" ")).not.toContain("(");
  });
});

describe("a payment schedule", () => {
  const TOTALS = ["| Totals |", "| --- |", "| Total Revenue, excluding taxes | €100,000.00 |", "| Taxes | €12,000.00 |", "| Total Revenue, including taxes | €112,000.00 |"].join("\n");
  const schedule = (first: string, second: string) =>
    [TOTALS, "", `[20] % payable on signing\t${first}`, "", `[50] % payable 90 days before arrival\t${second}`, "", "All percentages above refer to the Total Revenue, exclusive of applicable taxes."].join("\n");

  it("says when the payments are worked out on the total including tax", () => {
    expect(checkDocument(schedule("€22,400.00", "€56,000.00"))).toEqual([
      {
        source: "check",
        headline: "A payment schedule is worked out on the total including tax.",
        detail:
          "The payments are 20%, 50% of €112,000.00, the total including taxes, but the contract says the percentages refer to the total exclusive of tax (€100,000.00). On that total the first payment would be €20,000.00, not €22,400.00.",
      },
    ]);
  });

  it("says nothing when the payments use the total the contract names", () => {
    expect(checkDocument(schedule("€20,000.00", "€50,000.00"))).toEqual([]);
  });
});
