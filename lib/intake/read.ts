import type { StandardSet } from "../standards/sets";
import { BRAND_PLACES, brandsIn, setBrands, setForBrand, type HotelBrand } from "./brands";

/**
 * Reads the property name and the hotel brand off a contract at upload, by
 * local rules (user's decision, 2026-10-07). Nothing is sent anywhere.
 *
 * The associate confirms both before a review starts. A miss leaves a field
 * for them to type, as before. A wrong guess that gets confirmed sends the
 * contract to the wrong standards, so each rule gives nothing when it isn't
 * sure, and every guess carries the contract's own wording as evidence.
 */

export interface Read {
  value: string;
  /** The contract's wording the value came from. */
  evidence: string;
}

/** A contract names its hotel near the top. Further down, "Hotel:" is a notice address. */
const OPENING_CHARS = 8000;

const MAX_NAME_WORDS = 10;
const MAX_NAME_CHARS = 80;
const MAX_EVIDENCE_CHARS = 180;

/** Words that say which party is meant, and name nobody. */
const ROLE_WORDS = /^(?:the\s+)?(?:hotel|resort|property|venue|hotel name|group|client|n\/?a|tbd)$/i;

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string) => (s.length > MAX_EVIDENCE_CHARS ? `${s.slice(0, MAX_EVIDENCE_CHARS).trimEnd()}…` : s);

/** A candidate as a name, or null when it is a role word, empty, or too long to be one. */
function asName(candidate: string): string | null {
  const name = flat(candidate)
    .replace(/^(?:the|and)\s+/i, "")
    .replace(/[\s,.;:]+$/, "");
  if (!/\p{L}/u.test(name) || ROLE_WORDS.test(name)) return null;
  if (name.length > MAX_NAME_CHARS || name.split(" ").length > MAX_NAME_WORDS) return null;
  return name;
}

// "Hotel:" or "Hotel Name:" opening a line, a table cell or a bullet, or after
// other wording in the same cell. "Hotel Address:" and "Hotel Contact Name:"
// don't match, since the label must run straight to its colon.
const LABELLED = /(?:^|[|\n]|\s)(?:[▪•*-]\s*)?((?:Name of\s+)?(?:Hotel|Property|Resort|Venue)(?:\s+Name)?)\s*:[ \t]*\|?[ \t]*([^|\n(]*)/gi;

/** A row or cell that labels the hotel, such as "Hotel: | Seaside Grand Resort". */
function labelled(opening: string): Read | null {
  for (const match of opening.matchAll(LABELLED)) {
    // "Notices to Hotel: 2 Main Street" labels an address, so the label must open its line or cell.
    const before = opening.slice(0, match.index + match[0].indexOf(match[1]));
    const lead = before.slice(Math.max(before.lastIndexOf("\n"), before.lastIndexOf("|")) + 1);
    const opensCell = !/\p{L}/u.test(lead) || /(?:trading as|known as|d\/b\/a|dba)[,\s]*$/i.test(lead) || /:\s*[^:]*,\s*$/.test(lead);
    if (!opensCell) continue;

    const name = asName(match[2]);
    if (name) return { value: name, evidence: `${flat(match[1])}: ${name}` };
  }
  return null;
}

/**
 * True for a stretch of sentence rather than a name: it opens in lower case,
 * or carries a verb. "The parties are the Hotel" is prose, and a name isn't.
 */
function readsAsProse(candidate: string): boolean {
  return !/^[\p{Lu}\p{N}]/u.test(candidate) || /\b(?:is|are|was|were|will|shall|agrees?|hereby|means|entered|made)\b/.test(candidate);
}

// (the "Hotel"), ("Hotel"), (collectively, "Hotel" or "we")
const DEFINED = /\((?:the\s+|collectively,?\s+|hereinafter\s+(?:referred to as\s+)?)?["“”']?(?:Hotel|Resort|Property)["“”']?[^)]{0,80}\)/gi;

/** The party a sentence defines as the Hotel, such as: between X, located in Y (the "Hotel"). */
function definedTerm(opening: string): Read | null {
  for (const match of opening.matchAll(DEFINED)) {
    const before = opening.slice(Math.max(0, match.index - 240), match.index);

    // The hotel's own stretch starts after "between", or after the other party's "(…), and".
    const starts = [...before.matchAll(/\bbetween\s+|\)\s*,?\s*and\s+|[.\n|]\s*/gi)];
    const last = starts[starts.length - 1];
    const stretch = last ? before.slice(last.index + last[0].length) : before;

    // What follows the first comma describes the hotel: where it is, or what kind of company.
    const name = asName(stretch.split(",")[0]);
    if (name && !readsAsProse(name)) return { value: name, evidence: clip(flat(`${stretch}${match[0]}`)) };
  }
  return null;
}

export function readPropertyName(text: string): Read | null {
  const opening = text.slice(0, OPENING_CHARS);
  return labelled(opening) ?? definedTerm(opening);
}

export interface BrandRead {
  /** The hotel's brand as the contract names it. Null when it names none, or more than one. */
  brand: string | null;
  /** The standards set that brand's reviews read. Null means the default set. */
  set: string | null;
  evidence: string | null;
  /** Why no brand was read when one might have been, for the associate. */
  note: string | null;
}

type BrandSet = Pick<StandardSet, "key" | "name" | "brand_names" | "is_default">;

/** A sentence that names a brand only to compare the hotel with it. */
const COMPARISON = /\b(?:comparable|similar|such as|equivalent|equal or better|competitor|competing|other than)\b/i;

/** The text split into sentences and lines, with table bars and heading marks set aside. */
function sentences(text: string): string[] {
  return text
    .replace(BRAND_PLACES, " ")
    .split(/(?<=[.;?!])\s+|\n+/)
    .map((s) => flat(s.replace(/[|#]/g, " ")))
    .filter(Boolean);
}

/**
 * The hotel's brand, and the standards set its reviews read.
 *
 * The brand is the hotel's family, whether or not it has standards of its
 * own, since a family's lines share one set of standards. A brand in the
 * property name settles it. Otherwise the contract must name exactly one
 * brand family, outside any comparison. Two families, or none, give no brand,
 * and the associate enters it.
 */
export function readBrand(text: string, propertyName: string | null, sets: BrandSet[]): BrandRead {
  // A set's own brand names count even when the built-in list lacks them.
  const extra = setBrands(sets);
  const read = (brand: HotelBrand, evidence: string): BrandRead => ({
    brand: brand.family,
    set: setForBrand(brand.family, sets)?.key ?? null,
    evidence,
    note: null,
  });

  const inName = brandsIn(propertyName ?? "", { nameOnly: true, extra });
  if (inName.length === 1) return read(inName[0], flat(propertyName!));

  const found = new Map<string, { brand: HotelBrand; sentence: string }>();
  for (const sentence of sentences(text)) {
    if (COMPARISON.test(sentence)) continue;
    for (const brand of brandsIn(sentence, { extra })) {
      const seen = found.get(brand.family);

      // The most specific name a family is given stands for it.
      if (!seen || brand.name.length > seen.brand.name.length) found.set(brand.family, { brand, sentence: seen?.sentence ?? sentence });
    }
  }

  const families = [...found.values()];
  if (families.length === 1) return read(families[0].brand, clip(families[0].sentence));
  if (families.length > 1) {
    const list = families.map((hit) => hit.brand.family);
    const joined = list.length === 2 ? `both ${list[0]} and ${list[1]}` : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    return { brand: null, set: null, evidence: null, note: `This contract names ${joined}, so enter the brand yourself.` };
  }
  return { brand: null, set: null, evidence: null, note: null };
}
