import { describe, expect, it } from "vitest";
import { changeSegments, fold } from "@/lib/change-segments";

/**
 * A finding's change as the review card marks it up.
 *
 * A real force majeure card printed an 1,100-character sentence twice, once as
 * the quote and once inside the proposal, and left the reader to find what
 * changed. The contract wording here is invented.
 */

const kinds = (quote: string, language: string) => changeSegments(quote, language).map((s) => [s.kind, s.text.trim()]);

describe("changeSegments", () => {
  it("marks a replaced figure as struck and added, and keeps the rest unchanged", () => {
    expect(kinds("Damages are eighty percent (80%) of the rate.", "Damages are seventy percent (70%) of the rate.")).toEqual([
      ["same", "Damages are"],
      ["del", "eighty percent (80%)"],
      ["ins", "seventy percent (70%)"],
      ["same", "of the rate."],
    ]);
  });

  it("marks wording added at the end", () => {
    expect(kinds("We will refund your deposit.", "We will refund your deposit within thirty days.")).toEqual([
      ["same", "We will refund your"],
      ["del", "deposit."],
      ["ins", "deposit within thirty days."],
    ]);
  });

  it("marks wording struck with nothing in its place", () => {
    const segments = changeSegments(
      "We may substitute function space after consulting with you and notifying you in writing.",
      "We may substitute function space in writing."
    );
    expect(segments.filter((s) => s.kind === "del").map((s) => s.text)).toEqual(["after consulting with you and notifying you"]);
    expect(segments.some((s) => s.kind === "ins")).toBe(false);
  });

  it("reads the quote once, whatever line breaks it carries", () => {
    const joined = changeSegments("Payment is due\nwithin 30 days.", "Payment is due within 30 days.")
      .map((s) => s.text)
      .join("");
    expect(joined).toBe("Payment is due within 30 days.");
  });
});

describe("fold", () => {
  const long = " one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one ";

  it("keeps the words next to the changes on both sides of a long middle stretch", () => {
    expect(fold(long, false, false)).toBe(" one two three four five six … sixteen seventeen eighteen nineteen twenty twenty-one ");
  });

  it("keeps only the words before the first change, and after the last", () => {
    expect(fold(long, true, false)).toBe("… sixteen seventeen eighteen nineteen twenty twenty-one ");
    expect(fold(long, false, true)).toBe(" one two three four five six …");
  });

  it("leaves a short stretch whole", () => {
    expect(fold(" of the rate ", false, false)).toBe(" of the rate ");
  });
});
