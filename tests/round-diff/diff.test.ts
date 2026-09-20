import { describe, expect, it } from "vitest";
import { diffProjections, tokenize } from "@/lib/round-diff/diff";

/**
 * What changed between two versions of a contract (MASTER_PLAN.md §2.1.1).
 *
 * Every range assertion here slices the text back out rather than checking
 * offsets by eye. An off-by-one in a range is the failure this section's model
 * assignment exists to catch, and it is invisible in a passing offset number.
 */

const slice = (text: string, range: { start: number; end: number }) => text.slice(range.start, range.end);

describe("tokenize", () => {
  it("splits on the single spaces a projection leaves behind", () => {
    expect(tokenize("eighty percent (80%)").map((t) => t.text)).toEqual(["eighty", "percent", "(80%)"]);
  });

  it("gives every token a range that slices back to itself", () => {
    const text = "Group shall pay the shortfall.";
    for (const token of tokenize(text)) expect(text.slice(token.start, token.end)).toBe(token.text);
  });

  it("finds nothing in empty or blank text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("diffProjections", () => {
  it("reports nothing when the property returned what we sent", () => {
    const text = "Group shall pay eighty percent (80%) of the shortfall.";
    const result = diffProjections(text, text);
    expect(result.regions).toEqual([]);
    expect(result.retained).toBe(1);
    expect(result.rebased).toBe(false);
  });

  it("reports a countered percentage as one replacement, not two", () => {
    const before = "Group shall pay eighty percent (80%) of the shortfall.";
    const after = "Group shall pay seventy percent (70%) of the shortfall.";
    const { regions } = diffProjections(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0].kind).toBe("replace");
    expect(slice(before, regions[0].baseline)).toBe("eighty percent (80%)");
    expect(slice(after, regions[0].returned)).toBe("seventy percent (70%)");
  });

  it("reports an added clause as an insertion with nothing taken out", () => {
    const before = "One. Two. Three.";
    const after = "One. Two. Hotel shall hold the rate. Three.";
    const { regions, retained } = diffProjections(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0].kind).toBe("insert");
    expect(slice(after, regions[0].returned)).toBe("Hotel shall hold the rate.");
    expect(regions[0].baseline.start).toBe(regions[0].baseline.end);
    expect(retained).toBe(1);
  });

  it("reports a struck clause as a deletion", () => {
    const before = "One. Hotel shall hold the rate. Three.";
    const after = "One. Three.";
    const { regions } = diffProjections(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0].kind).toBe("delete");
    expect(slice(before, regions[0].baseline)).toBe("Hotel shall hold the rate.");
    expect(regions[0].returned.start).toBe(regions[0].returned.end);
  });

  it("changes the copy of a repeated phrase that actually changed", () => {
    const before =
      "Group shall pay eighty percent (80%) of the shortfall. " +
      "Group shall pay eighty percent (80%) of the room rate.";
    const after =
      "Group shall pay seventy percent (70%) of the shortfall. " +
      "Group shall pay eighty percent (80%) of the room rate.";
    const { regions } = diffProjections(before, after);

    expect(regions).toHaveLength(1);
    expect(regions[0].baseline.start).toBeLessThan(before.indexOf("shortfall"));
    expect(slice(before, regions[0].baseline)).toBe("eighty percent (80%)");
  });

  it("reads a clause that changed place as a move, not a loss and a gain", () => {
    // The clause moves past far more text than it contains, so reading the rest
    // of the contract as having moved instead would be the much larger edit.
    const moved = "Hotel shall hold the group rate through cutoff.";
    const rest = [
      "Unreserved rooms release automatically at the published deadline.",
      "Payment falls due fourteen days following departure without demand.",
      "Parking, wifi and fitness access are billed separately per night.",
      "Indemnity extends only to third-party claims arising from negligence.",
      "Force majeure suspends obligations while the disabling event continues.",
    ].join(" ");
    const before = `${moved} ${rest}`;
    const after = `${rest} ${moved}`;

    const { regions } = diffProjections(before, after);
    const moves = regions.filter((r) => r.kind === "move");
    expect(moves).toHaveLength(2);

    const left = moves.find((r) => r.baselineText)!;
    const right = moves.find((r) => r.returnedText)!;
    expect(left.baselineText).toContain("hold the group rate");
    expect(right.returnedText).toContain("hold the group rate");
    expect(regions[left.moveCounterpart!]).toBe(right);
    expect(regions[right.moveCounterpart!]).toBe(left);
  });

  it("reports a bare swap of two adjacent clauses in full, without calling it a move", () => {
    // Two adjacent clauses trading places is symmetric, and the alignment runs
    // through the word they share, so neither side reads as a clean relocation.
    // It comes back as an insertion and a deletion instead. Nothing is lost,
    // which is the property that matters.
    const a = "Hotel shall hold the group rate through the stated cutoff date.";
    const b = "Group shall release unsold rooms on the published release date.";

    const { regions } = diffProjections(`${a} ${b}`, `${b} ${a}`);
    const reported = regions.map((r) => `${r.baselineText} ${r.returnedText}`).join(" ");
    for (const word of ["unsold", "published", "release"]) expect(reported).toContain(word);
  });

  it("finds one change in a contract-sized document", () => {
    const clause = (n: number) =>
      `Clause ${n}. The parties acknowledge obligation number ${n} under schedule ${n} hereto.`;
    const before = Array.from({ length: 400 }, (_, i) => clause(i)).join(" ");
    const after = before.replace(
      "obligation number 200",
      "obligation number 200 as amended and restated"
    );

    const started = Date.now();
    const { regions, rebased } = diffProjections(before, after);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(rebased).toBe(false);
    expect(regions).toHaveLength(1);
    expect(regions[0].returnedText).toContain("as amended and restated");
  });

  it("does not call two short matching phrases a move", () => {
    const before = "Rate is 70%. Alpha beta gamma delta epsilon zeta eta theta.";
    const after = "Alpha beta gamma delta epsilon zeta eta theta. Rate is 70%.";
    const { regions } = diffProjections(before, after);
    expect(regions.every((r) => r.kind !== "move")).toBe(true);
  });

  it("flags a document that shares almost nothing with what we sent", () => {
    const before = "Group shall reserve eighty rooms and pay the agreed rate on arrival.";
    const after = "The parties agree to arbitrate all disputes in the county of the hotel.";
    const { rebased, retained } = diffProjections(before, after);

    expect(rebased).toBe(true);
    expect(retained).toBeLessThan(0.4);
  });

  it("does not flag a heavily but honestly edited document as re-based", () => {
    const before = "Group shall pay eighty percent (80%) of the shortfall on the cutoff date.";
    const after = "Group shall pay seventy percent (70%) of the shortfall on the cutoff date.";
    expect(diffProjections(before, after).rebased).toBe(false);
  });

  it("keeps every range sliceable, on a paragraph with several edits", () => {
    const before =
      "Attrition is measured night by night. Liability applies below eighty percent (80%) pickup. " +
      "Resold rooms are not credited. Cancellation follows the schedule.";
    const after =
      "Attrition is measured cumulatively. Liability applies below seventy percent (70%) pickup. " +
      "Resold rooms are credited against any shortfall. Cancellation follows the schedule.";

    const { regions } = diffProjections(before, after);
    expect(regions.length).toBeGreaterThanOrEqual(3);
    for (const region of regions) {
      expect(slice(before, region.baseline)).toBe(region.baselineText);
      expect(slice(after, region.returned)).toBe(region.returnedText);
      expect(region.baseline.end).toBeGreaterThanOrEqual(region.baseline.start);
      expect(region.returned.end).toBeGreaterThanOrEqual(region.returned.start);
    }
  });

  it("reports regions in document order", () => {
    const before = "alpha one. beta two. gamma three. delta four.";
    const after = "alpha ONE. beta two. gamma THREE. delta four.";
    const { regions } = diffProjections(before, after);
    const starts = regions.map((r) => r.baseline.start);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });

  it("handles a gap with no distinctive wording to anchor on", () => {
    // Every token repeats, so patience finds no anchor and Myers finishes it.
    const before = "a b a b a b a b";
    const after = "a b a b b a b a";
    const { regions } = diffProjections(before, after);
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(slice(before, region.baseline)).toBe(region.baselineText);
      expect(slice(after, region.returned)).toBe(region.returnedText);
    }
  });

  it("reads an empty document on either side without inventing a correspondence", () => {
    expect(diffProjections("", "").regions).toEqual([]);
    expect(diffProjections("", "new text").regions.map((r) => r.kind)).toEqual(["insert"]);
    expect(diffProjections("old text", "").regions.map((r) => r.kind)).toEqual(["delete"]);
  });
});
