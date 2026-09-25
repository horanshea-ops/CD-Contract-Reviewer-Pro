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
