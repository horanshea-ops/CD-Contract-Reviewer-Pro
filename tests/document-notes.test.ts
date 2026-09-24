import { describe, expect, it } from "vitest";
import { toNotes } from "@/lib/document-notes";

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

  it("reads a list stored as a JSON string, keeps at most five, and drops empty items", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ headline: `Note ${i + 1}.`, detail: "" }));
    expect(toNotes(JSON.stringify([{ headline: "  ", detail: "x" }, ...many]))).toHaveLength(5);
  });

  it("gives nothing for nothing", () => {
    expect(toNotes(null)).toEqual([]);
    expect(toNotes("")).toEqual([]);
    expect(toNotes([])).toEqual([]);
  });
});
