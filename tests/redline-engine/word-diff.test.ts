import { describe, expect, it } from "vitest";
import { wordChanges, type WordChange } from "@/lib/redline-engine/word-diff";

/**
 * Which words a proposal changes. Every case checks that making the changes
 * turns the passage into the proposal, because a change list that reads well
 * but doesn't add up to the proposal would put the wrong wording in front of a
 * hotel.
 */

const apply = (passage: string, changes: WordChange[]) =>
  [...changes].reverse().reduce((out, c) => out.slice(0, c.from) + c.text + out.slice(c.to), passage);

const shown = (passage: string, changes: WordChange[]) =>
  changes.map((c) => [passage.slice(c.from, c.to), c.text]);

describe("wordChanges", () => {
  it("changes only the words that differ", () => {
    const passage = "The Hotel may cancel on thirty (30) days notice to Group.";
    const proposal = "The Hotel may cancel on ninety (90) days notice to Group.";
    const changes = wordChanges(passage, proposal);
    expect(shown(passage, changes)).toEqual([["thirty (30)", "ninety (90)"]]);
    expect(apply(passage, changes)).toBe(proposal);
  });

  it("treats a word and the punctuation touching it as one unit", () => {
    const passage = "within twelve (12) hours of the warning";
    const proposal = "within seventy-two (72) hours of the warning";
    expect(shown(passage, wordChanges(passage, proposal))).toEqual([["twelve (12)", "seventy-two (72)"]]);
  });

  it("adds wording as a pure insertion", () => {
    const passage = "Deposit is due on signing of this Agreement.";
    const proposal = "Deposit is due on signing of this Agreement. No other deposit is required.";
    const changes = wordChanges(passage, proposal);
    expect(changes).toEqual([{ from: passage.length, to: passage.length, text: " No other deposit is required." }]);
    expect(apply(passage, changes)).toBe(proposal);
  });

  it("puts wording added in front as an insertion, not a retyped word", () => {
    const passage = "the rate is fixed for the term.";
    const proposal = "Notwithstanding the foregoing, the rate is fixed for the term.";
    const changes = wordChanges(passage, proposal);
    expect(shown(passage, changes)).toEqual([["", "Notwithstanding the foregoing, "]]);
    expect(apply(passage, changes)).toBe(proposal);
  });

  it("removes wording as a pure deletion", () => {
    const passage = "Group shall pay, without setoff or deduction, the full amount due.";
    const proposal = "Group shall pay the full amount due.";
    const changes = wordChanges(passage, proposal);
    expect(shown(passage, changes)).toEqual([["pay, without setoff or deduction,", "pay"]]);
    expect(apply(passage, changes)).toBe(proposal);
  });

  it("joins two changes separated by fewer than three shared words", () => {
    const passage = "The Hotel may cancel on thirty (30) days notice to Group.";
    const proposal = "The Hotel may cancel on ninety (90) days written notice to Group.";
    expect(shown(passage, wordChanges(passage, proposal))).toEqual([["thirty (30) days", "ninety (90) days written"]]);
  });

  it("keeps two changes apart when three or more shared words sit between them", () => {
    const passage = "Group shall pay eighty percent of the contracted room block by the cutoff date.";
    const proposal = "Group shall pay seventy percent of the contracted room block by the arrival date.";
    expect(shown(passage, wordChanges(passage, proposal))).toEqual([
      ["eighty", "seventy"],
      ["cutoff", "arrival"],
    ]);
  });

  it("returns one whole change for a rewrite", () => {
    const passage = "the Hotel shall be entitled to recover punitive damages to the extent permitted by law.";
    const proposal = "Any award will be limited to actual damages; punitive damages will not be awarded.";
    expect(wordChanges(passage, proposal)).toEqual([{ from: 0, to: passage.length, text: proposal }]);
  });

  it("returns one whole change when fewer than half the words are kept", () => {
    const passage = "eighty percent (80%)";
    const proposal = "seventy percent (70%)";
    expect(wordChanges(passage, proposal)).toEqual([{ from: 0, to: passage.length, text: proposal }]);
  });

  it("keeps the contract's spacing where words are shared", () => {
    const passage = "Group shall pay  the deposit.  Payment is due on signing.";
    const proposal = "Group shall pay the deposit. Payment is due on arrival.";
    const changes = wordChanges(passage, proposal);
    expect(shown(passage, changes)).toEqual([["signing.", "arrival."]]);
    expect(apply(passage, changes)).toBe("Group shall pay  the deposit.  Payment is due on arrival.");
  });

  it("makes no change when only the spacing differs", () => {
    expect(wordChanges("Group  shall pay.", "Group shall pay.")).toEqual([]);
  });

  it("always adds up to the proposal, apart from spacing", () => {
    // Seeded, so a failure reproduces.
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const vocabulary = ["the", "Hotel", "Group", "shall", "pay", "(30)", "days", "notice,", "rate.", "a", "of"];
    const sentence = (length: number) =>
      Array.from({ length }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(" ");

    for (let k = 0; k < 500; k++) {
      const passage = sentence(1 + Math.floor(random() * 25));
      const words = passage.split(" ");
      const edited = words
        .flatMap((w) => {
          const roll = random();
          if (roll < 0.1) return [];
          if (roll < 0.2) return [sentence(1)];
          if (roll < 0.3) return [w, sentence(2)];
          return [w];
        })
        .join(" ");
      const proposal = edited || "Deleted.";
      const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(collapse(apply(passage, wordChanges(passage, proposal)))).toBe(collapse(proposal));
    }
  });
});
