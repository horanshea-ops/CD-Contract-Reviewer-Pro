import { describe, expect, it } from "vitest";
import { toNotes, withoutRepeats } from "@/lib/document-notes";

/**
 * The model's notes on the document, held to one line each.
 *
 * The first notes the app saved were one paragraph of eight long sentences,
 * which nobody reads.
 */

describe("toNotes", () => {
  it("keeps a well-formed list as it is", () => {
    const notes = [{ headline: "Meeting dates say 2010 in one place and 2015 elsewhere.", detail: "The table is likely wrong." }];
    expect(toNotes(notes)).toEqual(notes);
  });

  it("cuts a headline to one sentence and the detail to two", () => {
    const [note] = toNotes([
      {
        headline: "The dates disagree. The table says 2010.",
        detail: "Everything else says 2015. The signing deadline is 2013. Footers are numbered twice.",
      },
    ]);
    expect(note).toEqual({ headline: "The dates disagree.", detail: "The table says 2010. Everything else says 2015." });
  });

  it("shortens a long headline, and keeps the whole sentence in the detail", () => {
    const long =
      "The document is internally inconsistent on dates in several places, since the General Information table lists the meeting as October 2010 while every other reference uses October 2015.";
    const [n] = toNotes(long);
    expect(n.headline).toBe("The document is internally inconsistent on dates in several places, since the General Information table lists…");
    expect(n.detail).toBe(long);
  });

  it("reads notes saved as one block of text", () => {
    const legacy =
      "The document is internally inconsistent on dates. The General Information table lists 2010. Every other reference uses 2015. The footers are numbered inconsistently.";
    expect(toNotes(legacy)).toEqual([
      {
        headline: "The document is internally inconsistent on dates.",
        detail: "The General Information table lists 2010. Every other reference uses 2015.",
      },
    ]);
  });

  it("reads a list stored as a JSON string, keeps every note, and drops empty items", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ headline: `Note ${i + 1}.`, detail: "" }));
    expect(toNotes(JSON.stringify([{ headline: "  ", detail: "x" }, ...many]))).toHaveLength(10);
  });

  it("gives nothing for nothing", () => {
    expect(toNotes(null)).toEqual([]);
    expect(toNotes("")).toEqual([]);
    expect(toNotes([])).toEqual([]);
  });
});

describe("withoutRepeats", () => {
  // Shaped like a real review whose notes repeated two of the app's date checks.
  const checks = [
    { headline: "A booking checks out before it checks in.", detail: "A booking checks in on 14/06/2027 and out on 01/06/2027." },
    {
      headline: "A date range ends before it starts.",
      detail: 'The contract gives a range "between November January 1st 2027 and March 31st 2026", which ends before it starts.',
    },
    {
      headline: "The revenue table's totals don't add up in one place.",
      detail: "Total Anticipated Revenue adds up to 147,000 (115,000 + 20,000 + 12,000), but the table says 152,000.",
    },
  ];

  it("hides notes that name the same dates as a check", () => {
    const notes = [
      { headline: "The extra rooms check out before they arrive.", detail: "'Check in 14/06/2027 Check out 01/06/2027' comes before the event (14/06/2027 to 18/06/2027)." },
      { headline: "A cancellation tier's dates run backwards.", detail: "The tier runs from January 1st, 2027 to March 31st 2026." },
    ];
    expect(withoutRepeats(notes, checks)).toEqual([]);
  });

  it("keeps notes that share at most one figure with any check", () => {
    const notes = [
      { headline: "Two F&B minimums appear.", detail: "The F&B clause says €20,000.00, but waiving the office fee needs €25,000." },
      { headline: "Impossibility is defined twice.", detail: "Section 21 uses a 20-mile radius and Section 22 a 5-mile radius." },
      { headline: "A deposit falls due before signing.", detail: "The first deposit is due 14/06/2027." },
    ];
    expect(withoutRepeats(notes, checks)).toEqual(notes);
  });
});
