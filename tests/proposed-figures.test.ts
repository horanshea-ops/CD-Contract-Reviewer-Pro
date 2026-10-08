import { describe, expect, it } from "vitest";
import { figureCheck } from "@/lib/proposed-figures";
import { previewFindings } from "@/lib/redline-engine/preflight";

/**
 * A proposed amount that no longer follows from the formula beside it.
 *
 * The wording here is from two stored reviews of one contract. A person found
 * both wrong figures by opening the redlines in Word on 2026-10-08.
 */

const ROOM = (amount: string, rates: string) =>
  `${amount} [determined by multiplying the Minimum Number of Room Nights, times the Group Room Rate, ${rates}]`;
const FB = (amount: string, rate: string) => `${amount} [determined by multiplying the Food & Beverage Minimum times ${rate}]`;

describe("figureCheck", () => {
  it("flags a percentage that changed while its amount stayed", () => {
    expect(figureCheck(FB("$80,000.00", "80%"), FB("$80,000.00", "35%"))).toBe(
      "Check this amount. At 35% of the contract's $100,000.00 base it would be $35,000.00. The wording says $80,000.00."
    );
  });

  it("flags an amount that changed while its percentage stayed", () => {
    expect(figureCheck(FB("$80,000.00", "80%"), FB("$64,000.00", "80%"))).toBe(
      "Check this amount. At 80% of the contract's $100,000.00 base it would be $80,000.00. The wording says $64,000.00."
    );
  });

  it("passes an amount worked out correctly through an added factor", () => {
    const tiers = [
      ["$16,986.00", "times 5%", "$11,890.20", "times 70%, times 5%"],
      ["$169,860.00", "times 50%", "$118,902.00", "times 70%, times 50%"],
      ["$220,818.00", "times 65%", "$154,572.60", "times 70%, times 65%"],
      ["$254,790.00", "times 75%", "$178,353.00", "times 70%, times 75%"],
      ["$305,748.00", "times 90%", "$214,023.60", "times 70%, times 90%"],
    ];
    for (const [was, rate, now, rates] of tiers) expect(figureCheck(ROOM(was, rate), ROOM(now, rates)), now).toBeNull();
  });

  it("flags an amount worked out from a base the contract doesn't use, and shows both factors", () => {
    expect(figureCheck(ROOM("$16,986.00", "times 5%"), ROOM("$10,586.15", "times 70%, times 5%"))).toBe(
      "Check this amount. At 70% × 5% of the contract's $339,720.00 base it would be $11,890.20. The wording says $10,586.15."
    );
  });

  it("checks each amount in a table row quoted whole", () => {
    const row = (room: string, fb: string) => `| 90 Days or Less  | ${room}  | ${fb}  |`;
    const quote = row(ROOM("$305,748.00", "times 90%"), FB("$80,000.00", "80%"));

    expect(figureCheck(quote, row(ROOM("$214,023.60", "times 70%, times 90%"), FB("$80,000.00", "80%")))).toBeNull();
    expect(figureCheck(quote, row(ROOM("$214,023.60", "times 70%, times 90%"), FB("$64,000.00", "80%")))).toBe(
      "Check this amount. At 80% of the contract's $100,000.00 base it would be $80,000.00. The wording says $64,000.00."
    );
    expect(figureCheck(quote, row(ROOM("$190,550.70", "times 70%, times 90%"), FB("$64,000.00", "80%")))).toMatch(
      /^Check these amounts\. At 70% × 90% .* At 80% of the contract's \$100,000\.00 base/
    );
  });

  it("allows for amounts rounded to the dollar or the cent", () => {
    // 33.3% of $1,000 is $333, and 12.5% of that base is $125.13 before rounding.
    expect(figureCheck("$333 [the minimum times 33.3%]", "$125 [the minimum times 12.5%]")).toBeNull();
    expect(figureCheck("$333 [the minimum times 33.3%]", "$135 [the minimum times 12.5%]")).not.toBeNull();
    expect(figureCheck("$333.00 [the minimum times 33.3%]", "$125.00 [the minimum times 12.5%]")).toBeNull();
  });

  it("says nothing when the wording gives it nothing certain to check", () => {
    // A new clause has no contract figure to compare with.
    expect(figureCheck(null, FB("$35,000.00", "35%"))).toBeNull();
    // No formula beside the amount.
    expect(figureCheck("The fee is $80,000.00.", "The fee is $35,000.00.")).toBeNull();
    // A different number of pairs before and after.
    expect(figureCheck(FB("$80,000.00", "80%"), `${FB("$35,000.00", "35%")} plus ${FB("$10,000.00", "10%")}`)).toBeNull();
    // The formula itself was reworded, so the two bases aren't the same thing.
    expect(figureCheck(FB("$80,000.00", "80%"), "$70,000.00 [determined by multiplying the Room Revenue times 35%]")).toBeNull();
    // A blank is the wording check's business.
    expect(figureCheck(FB("$80,000.00", "80%"), "$[X] [determined by multiplying the Food & Beverage Minimum times 35%]")).toBeNull();
    // A zero rate has no base.
    expect(figureCheck(FB("$0.00", "0%"), FB("$35,000.00", "35%"))).toBeNull();
  });
});

describe("the card's preview", () => {
  const finding = (id: string, language: string) => ({ id, quoted_text: FB("$80,000.00", "80%"), is_missing_clause: false, language });

  it("carries the check beside the export note, and leaves the change in the redline", () => {
    const previews = previewFindings([finding("wrong", FB("$80,000.00", "35%")), finding("right", FB("$35,000.00", "35%"))], null);

    expect(previews.get("wrong")).toMatchObject({ export_issue: null, figure_check: expect.stringMatching(/^Check this amount\./) });
    expect(previews.get("right")).toEqual({ export_issue: null, redline_language: null });
  });

  it("checks the associate's edit, so a corrected amount clears the warning", () => {
    const edited = previewFindings([finding("edited", FB("$35,000.00", "35%"))], null);
    expect(edited.get("edited")?.figure_check).toBeUndefined();
  });
});
