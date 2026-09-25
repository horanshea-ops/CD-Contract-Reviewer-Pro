import { describe, expect, it } from "vitest";
import { extractDocx, loadDocx } from "@/lib/docx";
import { findPictures, imageInfo } from "@/lib/docx/pictures";
import { pictureContext, pictureNotes } from "@/lib/document-checks";
import { buildDocx } from "../helpers/docx-package";

/**
 * Pictures that may hold figures the text leaves out. A real contract pasted
 * its room block, rates included, in as a picture, and stretched a tiny icon
 * across the page further down. The wording here is invented.
 */

const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const drawing = (widthIn: number, heightIn: number, rel: string | null = "rId8") =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
  `<wp:extent cx="${Math.round(widthIn * 914400)}" cy="${Math.round(heightIn * 914400)}"/>` +
  `${rel ? `<a:blip r:embed="${rel}"/>` : ""}</wp:inline></w:drawing></w:r></w:p>`;

/** The header of a PNG this size. Only the header is read. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const EMF = new Uint8Array([1, 0, 0, 0, 108, 0, 0, 0, 0, 0, 0, 0]);

const rels = (targets: Record<string, string>) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  Object.entries(targets)
    .map(([id, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`)
    .join("") +
  `</Relationships>`;

async function picturesIn(body: string, media: Record<string, Uint8Array> = { "media/image1.png": png(2048, 232) }) {
  const targets = Object.fromEntries(Object.keys(media).map((path, i) => [`rId${8 + i}`, path]));
  const files = Object.fromEntries(Object.entries(media).map(([path, bytes]) => [`word/${path}`, bytes]));
  const bytes = await buildDocx(body, { "word/_rels/document.xml.rels": rels(targets), ...files });
  return findPictures(await loadDocx(bytes));
}

describe("findPictures", () => {
  it("records a wide picture with the paragraph before it, and keeps its image", async () => {
    const { pictures, images } = await picturesIn(para("Terms apply.") + para("Room Block &amp; Rates:") + drawing(7.5, 0.85));
    expect(pictures).toEqual([{ near: "Room Block & Rates:", readable: true }]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ near: "Room Block & Rates:", mediaType: "image/png" });
    expect(Buffer.from(images[0].data, "base64")).toEqual(Buffer.from(png(2048, 232)));
  });

  it("shortens a long paragraph to its opening words", async () => {
    const { pictures } = await picturesIn(para("Room Block Booking Details (all applicable room types must be specified below in full):") + drawing(6, 1));
    expect(pictures).toEqual([{ near: "Room Block Booking Details (all applicable room types must be specified below…", readable: true }]);
  });

  it("passes over icons, thin rules and shapes that aren't pictures", async () => {
    expect((await picturesIn(para("Tick") + drawing(0.09, 0.09))).pictures).toEqual([]);
    expect((await picturesIn(para("Rule") + drawing(6, 0.05))).pictures).toEqual([]);
    expect((await picturesIn(para("Shape") + drawing(6, 1, null))).pictures).toEqual([]);
  });

  it("passes over a tiny icon stretched across the page", async () => {
    const found = await picturesIn(para("Payment Breakdown") + drawing(3, 1.3), { "media/image2.png": png(23, 24) });
    expect(found).toEqual({ pictures: [], images: [] });
  });

  it("notes a picture in a format the model can't read, without sending it", async () => {
    const found = await picturesIn(para("Room Block") + drawing(6, 1), { "media/image1.emf": EMF });
    expect(found).toEqual({ pictures: [{ near: "Room Block", readable: false }], images: [] });
  });

  it("sends at most four pictures", async () => {
    const body = [1, 2, 3, 4, 5].map((n) => para(`Table ${n}`) + drawing(6, 1, "rId8")).join("");
    const { pictures, images } = await picturesIn(body);
    expect(pictures.map((p) => p.readable)).toEqual([true, true, true, true, false]);
    expect(images).toHaveLength(4);
  });

  it("keeps image data out of the stored health record", async () => {
    const bytes = await buildDocx(para("Room Block") + drawing(6, 1), {
      "word/_rels/document.xml.rels": rels({ rId8: "media/image1.png" }),
      "word/media/image1.png": png(1200, 300),
    });
    const extracted = await extractDocx(bytes);
    expect(extracted.health.pictures).toEqual([{ near: "Room Block", readable: true }]);
    expect(extracted.pictures).toHaveLength(1);
  });
});

describe("reading image headers", () => {
  it("reads PNG, GIF and JPEG sizes, and refuses other formats", () => {
    expect(imageInfo(png(640, 80))).toEqual({ mediaType: "image/png", width: 640, height: 80 });

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x80, 0x02, 0x50, 0x00]);
    expect(imageInfo(gif)).toEqual({ mediaType: "image/gif", width: 640, height: 80 });

    // SOI, an APP0 segment of 4 bytes, then a baseline frame header: 80 high, 640 wide.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 80, 2, 128, 3]);
    expect(imageInfo(jpeg)).toEqual({ mediaType: "image/jpeg", width: 640, height: 80 });

    expect(imageInfo(EMF)).toBeNull();
  });
});

describe("what the review says about pictures", () => {
  it("tells the associate which pictures it read and which it couldn't", () => {
    expect(pictureNotes([{ near: "Room Block", readable: true }, { near: "Payment Breakdown" }])).toEqual([
      {
        source: "check",
        headline: 'The review read a picture near "Room Block" as an image.',
        detail: "The app can't check its figures or change it in the redline, so confirm any figure a finding takes from it.",
      },
      {
        source: "check",
        headline: 'The contract has a picture near "Payment Breakdown" that the review can\'t read.',
        detail: "Check any figures in it, such as rates or room counts, by hand. Findings and exposures here don't use them.",
      },
    ]);
    expect(pictureNotes(undefined)).toEqual([]);
  });

  it("tells the model to read attached pictures but not quote them", () => {
    expect(pictureContext([{ near: "Room Block", readable: true }])).toBe(
      "A picture from the contract is attached after the contract text. Read it as part of the contract. " +
        "Its wording isn't in the contract text, so don't put it in quoted_text or deal_figures. Name the picture in your reasoning instead."
    );
  });

  it("tells the model where unread pictures are and not to infer what they hold", () => {
    expect(pictureContext([{ near: "Room Block" }, { near: "Payment Breakdown" }])).toBe(
      'The contract has pictures near "Room Block" and "Payment Breakdown" that this text leaves out. Their contents weren\'t read, so don\'t infer figures from them.'
    );
    expect(pictureContext([])).toBeUndefined();
  });
});
