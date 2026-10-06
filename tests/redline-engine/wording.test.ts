import { describe, expect, it } from "vitest";
import { wordingProblem } from "@/lib/redline-engine/wording";

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
