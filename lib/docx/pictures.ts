import type { ContractPicture } from "./types";

/**
 * Pictures in the contract body big enough to hold a table or figures.
 *
 * Extraction reads text only, so a room block pasted in as a picture never
 * reaches the model or the arithmetic checks. A real contract carried its
 * rates that way. Knowing where such a picture sits lets the review say so
 * instead of working as if the figures weren't there.
 *
 * Size is read from each drawing's displayed extent. Icons and bullets fall
 * well under it, and logos usually sit in headers, which aren't read here.
 */

const EMU_PER_INCH = 914_400;
const MIN_WIDTH = 3 * EMU_PER_INCH;
const MIN_HEIGHT = 0.3 * EMU_PER_INCH;

/** How far back, in XML characters, to look for the paragraph before a picture. */
const LOOKBACK = 8_000;
const NEAR_WORDS = 12;

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => unescape(m[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

export function findPictures(documentXml: string): ContractPicture[] {
  const pictures: ContractPicture[] = [];
  for (const drawing of documentXml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
    const extent = drawing[0].match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    if (!extent || !drawing[0].includes("<a:blip")) continue;
    if (Number(extent[1]) < MIN_WIDTH || Number(extent[2]) < MIN_HEIGHT) continue;

    // The nearest paragraph with text before the picture, which is usually its heading.
    const before = documentXml.slice(Math.max(0, drawing.index! - LOOKBACK), drawing.index);
    const paragraph = before
      .split("</w:p>")
      .map(textOf)
      .reverse()
      .find((t) => t.length > 0);
    const words = (paragraph ?? "").split(" ");
    pictures.push({ near: words.length > NEAR_WORDS ? `${words.slice(0, NEAR_WORDS).join(" ")}…` : words.join(" ") });
  }
  return pictures;
}
