import { placeBrand, type BrandSetLike } from "./brands";
import type { BrandRead } from "./read";

/** A set of standards as the new-review form knows it. */
export interface BrandLineSet extends BrandSetLike {
  /** Whether a review can read this set today. */
  in_use: boolean;
}

const article = (word: string) => (/^[aeio]/i.test(word) ? "an" : "a");

/**
 * What the new-review form says under the brand: where the brand came from,
 * and which standards the review will use.
 *
 * A brand is always entered, since the hotel is that brand whether or not CD
 * has standards for it. A hotel of no brand is entered as the default set's
 * own name. Null when the sets couldn't be read.
 */
export function brandLine(read: BrandRead | null, sets: BrandLineSet[], brand: string): string | null {
  const fallback = sets.find((set) => set.is_default)?.name;
  if (!fallback) return null;

  const typed = brand.replace(/\s+/g, " ").trim();
  const ask = `Enter the hotel's brand, or ${fallback} if it has none.`;
  if (!typed) {
    if (read?.note) return read.note;
    return read ? `No brand found in the contract. ${ask}` : ask;
  }

  const placed = placeBrand(typed, sets);
  if (!placed) return ask;

  const lines: string[] = [];
  if (read?.brand && read.brand === typed && read.evidence) lines.push(`From the contract: “${read.evidence}”`);
  else if (placed.written) lines.push(`${placed.written} is ${article(placed.brand)} ${placed.brand} brand.`);

  const own = placed.set;
  if (placed.brand === fallback) lines.push(`This review will use ${fallback}'s standards.`);
  else if (own?.in_use) lines.push(`This review will use ${own.name}'s standards.`);
  else if (own) lines.push(`${own.name}'s standards aren't switched on yet, so this review will use ${fallback}'s.`);
  else if (placed.leftOutOf) {
    lines.push(`${placed.brand} isn't on ${placed.leftOutOf.name}'s list of brands, so this review will run against ${fallback}'s standards.`);
  } else lines.push(`There are no specific standards for this brand, so this review will run against ${fallback}'s standards.`);

  return lines.join(" ");
}
