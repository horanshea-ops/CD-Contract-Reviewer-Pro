import { describe, expect, it } from "vitest";
import { checkDocument } from "@/lib/document-checks";
import { datesIn, dateNotes, numericOrder } from "@/lib/date-checks";

/**
 * Dates the app checks against each other.
 *
 * Shaped like a real EMEA contract whose schedule ran past the event, whose
 * extra rooms checked out before they checked in, and whose cancellation
 * table had a tier that ended before it began. The wording is invented.
 */

const HEADER = [
  "| Event Dates:  | 14/06/2027 to 18/06/2027  | Name of Event:  | Test  |",
  "| Arrival Date:  | 14/06/2027  |   |   |",
].join("\n");

const SCHEDULE = [
  "Function Details",
  "",
  "| Date  | Time  | Event  | Room  |",
  "| --- | --- | --- | --- |",
  "| 15 /06 /2027  | 08:00 - 1 7 :00  | Office  | Aurora  |",
  "| 18/06 /2027  | 07 :00 - 09 :00  | Breakfast  | Terrace  |",
  "| 19 /0 6/2027  | 07 :00 - 09 :00  | Breakfast  | Terrace  |",
  "| 20 /06/2027  | 08:00 - 17:00  | Office  | Aurora  |",
].join("\n");

const EXTRA_ROOMS = "We are holding 12 additional bedrooms Check in 14/06/2027 Check out 01/06/2027 until the 1st March 2027.";

const CANCELLATION = [
  "| Cancellation between contract signature and November 30th 2026  |  5%  |",
  "|  Cancellation between November January 1st 2027 and March 31st 2026  |  10%  |",
  "|  Cancellation between April 1st 2027 and June 7th 2027  |  50%  |",
  "|  Cancellation from June 8th 2027 to arrival  |  100%  |",
].join("\n");

describe("reading dates", () => {
  it("reads written dates with or without the ordinal or comma", () => {
    const days = datesIn("September 28th 2027, October 4, 2010, 29th March 2027 and 17 March 2026", null).map((d) => d.text);
    expect(days).toEqual(["September 28th 2027", "October 4, 2010", "29th March 2027", "17 March 2026"]);
  });

  it("reads numeric dates through stray spaces once the order is known", () => {
    expect(datesIn("01 /1 0/2027", "day_first").map((d) => d.text)).toEqual(["01/10/2027"]);
  });

  it("works out day-first or month-first from dates that can only be read one way", () => {
    expect(numericOrder("26/09/2027")).toBe("day_first");
    expect(numericOrder("09/26/2027")).toBe("month_first");
    expect(numericOrder("01/02/2027 and 03/04/2027")).toBeNull();
    expect(numericOrder("26/09/2027 and 09/26/2027")).toBeNull();
  });

  it("leaves numeric dates unread when the order can't be told", () => {
    expect(datesIn("05/06/2027", null)).toEqual([]);
  });
});

describe("date checks", () => {
  it("flags schedule dates after the event ends", () => {
    expect(dateNotes(`${HEADER}\n\n${SCHEDULE}`)).toEqual([
      {
        source: "check",
        headline: "The schedule lists dates outside the event.",
        detail: "A schedule lists 19/06/2027 and 20/06/2027, after the event ends on 18/06/2027.",
      },
    ]);
  });

  it("says nothing when every schedule date falls inside the event", () => {
    const inside = SCHEDULE.replace("19 /0 6/2027", "16/06/2027").replace("20 /06/2027", "17/06/2027");
    expect(dateNotes(`${HEADER}\n\n${inside}`)).toEqual([]);
  });

  it("flags a booking that checks out before it checks in", () => {
    expect(dateNotes(`${HEADER}\n\n${EXTRA_ROOMS}`)).toEqual([
      {
        source: "check",
        headline: "A booking checks out before it checks in.",
        detail: "A booking checks in on 14/06/2027 and out on 01/06/2027.",
      },
    ]);
  });

  it("flags a date range that ends before it starts", () => {
    expect(dateNotes(CANCELLATION)).toEqual([
      {
        source: "check",
        headline: "A date range ends before it starts.",
        detail: 'The contract gives a range "between November January 1st 2027 and March 31st 2026", which ends before it starts.',
      },
    ]);
  });

  it("stays silent on written dates that agree", () => {
    const florida = [
      "| Meeting Dates:  | October 4, 2010 - October 11, 2010  |",
      "",
      "Two (2) suites arriving on October 3, 2010 and departing on October 12, 2010.",
      "Cancellation between January 1, 2010 and June 30, 2010 is 50%.",
    ].join("\n");
    expect(dateNotes(florida)).toEqual([]);
  });

  it("stays silent when every numeric date could be read either way", () => {
    const ambiguous = "| Event Dates: | 01/02/2027 to 01/05/2027 |\n\nCheck in 01/05/2027 Check out 01/02/2027.";
    expect(dateNotes(ambiguous)).toEqual([]);
  });

  it("runs as part of the document checks", () => {
    expect(checkDocument(`${HEADER}\n\n${EXTRA_ROOMS}`).map((n) => n.headline)).toEqual(["A booking checks out before it checks in."]);
  });
});
