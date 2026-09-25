import { describe, expect, it } from "vitest";
import { findPictures } from "@/lib/docx/pictures";
import { pictureContext, pictureNotes } from "@/lib/document-checks";

/**
 * Pictures that may hold figures the text leaves out. A real contract pasted
 * its room block, rates included, in as a picture. The wording here is invented.
 */

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const drawing = (widthIn: number, heightIn: number, blip = true) =>
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${Math.round(widthIn * 914400)}" cy="${Math.round(heightIn * 914400)}"/>` +
  `${blip ? '<a:blip r:embed="rId8"/>' : ""}</wp:inline></w:drawing></w:r></w:p>`;
const body = (...blocks: string[]) => `<w:document><w:body>${blocks.join("")}</w:body></w:document>`;

describe("findPictures", () => {
  it("records a wide picture with the paragraph before it", () => {
    const xml = body(para("Terms apply."), para("Room Block &amp; Rates:"), drawing(7.5, 0.85));
    expect(findPictures(xml)).toEqual([{ near: "Room Block & Rates:" }]);
  });

  it("shortens a long paragraph to its opening words", () => {
    const xml = body(para("Room Block Booking Details (all applicable room types must be specified below in full):"), drawing(6, 1));
    expect(findPictures(xml)).toEqual([{ near: "Room Block Booking Details (all applicable room types must be specified below…" }]);
  });

  it("passes over icons, thin rules and shapes that aren't pictures", () => {
    expect(findPictures(body(para("Tick"), drawing(0.09, 0.09)))).toEqual([]);
    expect(findPictures(body(para("Rule"), drawing(6, 0.05)))).toEqual([]);
    expect(findPictures(body(para("Shape"), drawing(6, 1, false)))).toEqual([]);
  });
});

describe("what the review says about pictures", () => {
  it("gives the associate one note per picture", () => {
    expect(pictureNotes([{ near: "Room Block Booking Details" }])).toEqual([
      {
        source: "check",
        headline: 'The contract has a picture near "Room Block Booking Details" that the review can\'t read.',
        detail: "Check any figures in it, such as rates or room counts, by hand. Findings and exposures here don't use them.",
      },
    ]);
    expect(pictureNotes(undefined)).toEqual([]);
  });

  it("tells the model where they are and not to infer what they hold", () => {
    expect(pictureContext([{ near: "Room Block" }, { near: "Payment Breakdown" }])).toBe(
      'The contract has pictures near "Room Block" and "Payment Breakdown" that this text leaves out. Their contents weren\'t read, so don\'t infer figures from them.'
    );
    expect(pictureContext([])).toBeUndefined();
  });
});
