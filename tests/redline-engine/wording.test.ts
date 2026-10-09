import { describe, expect, it } from "vitest";
import { blankContext, blanksIn, fillBlanks, wordingProblem } from "@/lib/redline-engine/wording";

/**
 * Blanks, and brackets that only look like them.
 *
 * A real review changed 80% to 35% inside a bracket the contract's own
 * cancellation table carries, and the card called the whole bracket a blank to
 * fill in. The wording here is invented in the same shape.
 */

const ROW = "90 Days or Less | $80,000.00 [determined by multiplying the Catering Minimum times 80%]";

describe("a bracket the contract already has", () => {
  it("is no blank when only its figure changes", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times 35%]";
    expect(wordingProblem(language, ROW)).toBeNull();
  });

  it("is no blank when wording is added inside it", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum, less resale, times 35%]";
    expect(wordingProblem(language, ROW)).toBeNull();
  });

  it("is no blank when it holds a bare number the proposal changes", () => {
    expect(wordingProblem("[25] % payable on signature.", "[10] % payable on signature.")).toBeNull();
  });

  it("is still a blank when a placeholder sits inside it", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times X%]";
    expect(wordingProblem(language, ROW)?.reason).toBe("unfilled_blank");
  });
});

describe("a real blank", () => {
  it.each(["[X]", "[date]", "[City, State]"])("%s is a blank the quote doesn't excuse", (blank) => {
    expect(wordingProblem(`A gratuity of ${blank} applies.`, ROW)?.reason).toBe("unfilled_blank");
  });

  it("is a bracket the quote has no like of", () => {
    const language = "One complimentary room per forty occupied, plus [suite and lounge concessions as listed].";
    const problem = wordingProblem(language, ROW);
    expect(problem?.reason).toBe("unfilled_blank");
    expect(problem?.detail).toContain("[suite and lounge concessions as listed]");
  });

  it("is a bracket in wording that quotes nothing", () => {
    expect(wordingProblem("Hotel will hold [determined by multiplying the block by X] rooms.", null)?.reason).toBe("unfilled_blank");
  });

  it("stays allowed when the quote holds it exactly", () => {
    expect(wordingProblem("Payment is due [date] in full.", "Payment is due [date].")).toBeNull();
  });
});

describe("finding every blank", () => {
  const SPACE =
    "Hotel will specify each function space assignment, minimum square footage ([X] square feet), and ceiling height requirement ([X] feet) in this Agreement.";

  it("lists each blank with where it sits", () => {
    const blanks = blanksIn(SPACE, null);

    expect(blanks.map((b) => b.bracket)).toEqual(["[X]", "[X]"]);
    expect(blanks.map((b) => SPACE.slice(b.start, b.end))).toEqual(["[X]", "[X]"]);
    expect(blanks[0].start).toBeLessThan(blanks[1].start);
  });

  it("finds none in wording that is ready to send", () => {
    expect(blanksIn("A gratuity of eighteen percent (18%) applies.", null)).toEqual([]);
  });

  it("skips a bracket the contract already has", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times 35%] plus [X] in fees";
    expect(blanksIn(language, ROW).map((b) => b.bracket)).toEqual(["[X]"]);
  });

  it("points at the placeholder inside a longer bracket, and keeps the bracket", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times X%]";
    const [blank] = blanksIn(language, ROW);

    expect(language.slice(blank.start, blank.end)).toBe("X");
    expect(fillBlanks(language, ROW, ["35"])).toBe(
      "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times 35%]"
    );
  });

  it.each([
    "A gratuity of [X]% applies.",
    "Payment is due [date] in full.",
    "One complimentary room per forty occupied, plus [suite and lounge concessions as listed].",
    SPACE,
  ])("agrees with the check the redline runs: %s", (language) => {
    expect(blanksIn(language, null).length > 0).toBe(wordingProblem(language, null)?.reason === "unfilled_blank");
    expect(wordingProblem(language, null)?.detail).toContain(blanksIn(language, null)[0].bracket);
  });
});

describe("filling blanks", () => {
  // Wording four stored reviews proposed, each left out of its redline for the blank.
  const STORED: [string, string[], string][] = [
    [
      "Food and beverage prices are subject to a gratuity of [X]%, fully distributed to the servers.",
      ["18"],
      "Food and beverage prices are subject to a gratuity of 18%, fully distributed to the servers.",
    ],
    [
      "You will use at least [X] room nights (seventy percent (70%) of the Total Room Block) at the Hotel.",
      ["1,596"],
      "You will use at least 1,596 room nights (seventy percent (70%) of the Total Room Block) at the Hotel.",
    ],
    [
      "The dollar amount owed at each tier will be stated in this Agreement as [X]. Punitive damages will not apply.",
      ["set out in Exhibit B"],
      "The dollar amount owed at each tier will be stated in this Agreement as set out in Exhibit B. Punitive damages will not apply.",
    ],
    [
      "Hotel will specify minimum square footage ([X] square feet), and ceiling height requirement ([X] feet) in this Agreement.",
      ["12,000", "14"],
      "Hotel will specify minimum square footage (12,000 square feet), and ceiling height requirement (14 feet) in this Agreement.",
    ],
  ];

  it.each(STORED)("fills %s", (language, values, filled) => {
    expect(fillBlanks(language, null, values)).toBe(filled);
    expect(wordingProblem(filled, null)).toBeNull();
  });

  it("gives two blanks written the same their own values", () => {
    expect(fillBlanks("Between [X] and [X] rooms.", null, ["40", "60"])).toBe("Between 40 and 60 rooms.");
  });

  it("trims what was typed", () => {
    expect(fillBlanks("A gratuity of [X]% applies.", null, ["  18 "])).toBe("A gratuity of 18% applies.");
  });

  it("leaves the contract's own bracket alone", () => {
    const language = "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times 35%] plus [X] in fees";
    expect(fillBlanks(language, ROW, ["$500"])).toBe(
      "90 Days or Less | $28,000.00 [determined by multiplying the Catering Minimum times 35%] plus $500 in fees"
    );
  });

  it.each([
    ["too few values", ["40"]],
    ["an empty value", ["40", "  "]],
  ])("fills nothing given %s", (_case, values) => {
    expect(fillBlanks("Between [X] and [X] rooms.", null, values)).toBeNull();
  });

  it("still reads as a blank when the value typed is one", () => {
    const filled = fillBlanks("A gratuity of [X]% applies.", null, ["[TBD]"])!;
    expect(blanksIn(filled, null)).toHaveLength(1);
  });
});

describe("the words around a blank", () => {
  const language =
    "Hotel will specify each function space assignment, minimum square footage ([X] square feet), and ceiling height requirement ([X] feet) in this Agreement.";
  const [first, second] = blanksIn(language, null);

  it("tells two blanks written the same apart", () => {
    expect(blankContext(language, first)).toEqual({ before: "… assignment, minimum square footage (", after: " square feet), and ceiling height …" });
    expect(blankContext(language, second)).toEqual({ before: "… and ceiling height requirement (", after: " feet) in this Agreement." });
  });

  it("marks no cut where the wording starts or ends", () => {
    const short = "Due [date].";
    expect(blankContext(short, blanksIn(short, null)[0])).toEqual({ before: "Due ", after: "." });
  });
});
