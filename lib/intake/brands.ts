/**
 * Hotel brands, as contracts write them, for reading a contract's brand by
 * local rules (lib/intake/read.ts).
 *
 * This list finds a brand's name in a contract and says which family it
 * belongs to. It does not decide which standards a review reads. Each
 * standards set holds its own list of the brands it covers, which an admin
 * edits on the Standards screen, and `placeBrand` matches a brand against
 * those lists.
 *
 * A brand on a set's list is shown under the set's name, so a family's lines
 * are not told apart: Hyatt Regency is Hyatt. A brand of a family CD has no
 * set for is shown as the family.
 *
 * A `nameOnly` brand is also an ordinary word or a person's name, so it is
 * read from the property name or the brand field and never from the body of
 * the contract.
 */

export interface HotelBrand {
  name: string;
  family: string;
  nameOnly?: boolean;
}

const family = (parent: string, names: string[], nameOnly: string[] = []): HotelBrand[] => [
  ...names.map((name) => ({ name, family: parent })),
  ...nameOnly.map((name) => ({ name, family: parent, nameOnly: true })),
];

export const HOTEL_BRANDS: HotelBrand[] = [
  ...family(
    "Hilton",
    [
      "Waldorf Astoria",
      "Signia by Hilton",
      "Curio Collection by Hilton",
      "Tapestry Collection by Hilton",
      "DoubleTree by Hilton",
      "DoubleTree",
      "Embassy Suites",
      "Hilton Garden Inn",
      "Hampton Inn",
      "Homewood Suites",
      "Home2 Suites",
      "Canopy by Hilton",
      "Tru by Hilton",
      "Hilton Grand Vacations",
      "Hilton",
    ],
    ["Conrad"]
  ),
  ...family(
    "Hyatt",
    ["Park Hyatt", "Grand Hyatt", "Hyatt Regency", "Hyatt Centric", "Hyatt Place", "Hyatt House", "Hyatt"],
    ["Andaz", "Thompson", "Alila", "Miraval"]
  ),
  ...family(
    "Marriott",
    [
      "JW Marriott",
      "Ritz-Carlton",
      "St. Regis",
      "Westin",
      "Sheraton",
      "Le Méridien",
      "Le Meridien",
      "Gaylord Hotels",
      "Autograph Collection",
      "Courtyard by Marriott",
      "Residence Inn",
      "Fairfield Inn",
      "SpringHill Suites",
      "Four Points by Sheraton",
      "Marriott",
    ],
    ["W Hotel", "Renaissance", "Gaylord", "Courtyard", "Aloft", "Delta Hotels"]
  ),
  ...family(
    "IHG",
    ["InterContinental", "Kimpton", "Crowne Plaza", "Hotel Indigo", "Holiday Inn Express", "Holiday Inn", "Staybridge Suites", "Candlewood Suites"],
    ["voco"]
  ),
  ...family("Omni", ["Omni Hotels"], ["Omni"]),
  ...family("Loews", ["Loews Hotels"], ["Loews"]),
  ...family("Accor", ["Fairmont", "Sofitel", "Novotel", "Swissôtel", "Swissotel"]),
  ...family("Four Seasons", ["Four Seasons"]),
  ...family("Wyndham", ["Wyndham Grand", "Wyndham"]),
  ...family("Radisson", ["Radisson Blu", "Radisson"]),
  ...family("Hard Rock", ["Hard Rock Hotel"], ["Hard Rock"]),
  ...family("Best Western", ["Best Western"]),
  ...family("Rosewood", ["Rosewood Hotels"], ["Rosewood"]),
  ...family("Mandarin Oriental", ["Mandarin Oriental"]),
  ...family("Choice", ["Cambria Hotels"], ["Cambria"]),
  ...family("Drury", ["Drury Plaza", "Drury Inn"], ["Drury"]),
];

/** Brand names that are also places. */
export const BRAND_PLACES = /\bHilton\s+Head\b/gi;

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordOf = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, "iu");

/**
 * The brands a stretch of text names, most specific first, one per family.
 * `extra` adds brands the list above lacks, such as a standards set's own.
 */
export function brandsIn(text: string, { nameOnly = false, extra = [] as HotelBrand[] } = {}): HotelBrand[] {
  const clean = text.replace(BRAND_PLACES, " ");

  // Longest first, so "Hyatt Regency" is read before "Hyatt".
  const known = new Set(HOTEL_BRANDS.map((brand) => brand.name.toLowerCase()));
  const candidates = [...HOTEL_BRANDS, ...extra.filter((brand) => !known.has(brand.name.toLowerCase()))].sort(
    (a, b) => b.name.length - a.name.length
  );

  const found: HotelBrand[] = [];
  for (const brand of candidates) {
    if (brand.nameOnly && !nameOnly) continue;
    if (found.some((f) => f.family === brand.family)) continue;
    if (wordOf(brand.name).test(clean)) found.push(brand);
  }
  return found;
}

/** A set of standards, as far as matching a brand to it goes. */
export interface BrandSetLike {
  key: string;
  name: string;
  /** The brands the set covers. An admin edits the list on the Standards screen. */
  brand_names: string[];
  is_default: boolean;
}

/**
 * A brand name in one spelling, so two ways of writing a brand compare equal:
 * "DoubleTree" and "DoubleTree by Hilton", "Omni" and "Omni Hotels",
 * "Le Méridien" and "Le Meridien".
 */
export function brandKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+by\s+.+$/, "")
    .replace(/\s+hotels?$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A set's listed brands that the list above lacks, so a contract naming one
 * is still read. A single added word is read from the property name and the
 * brand field only, since a common word would match all through a contract.
 */
export function setBrands(sets: BrandSetLike[]): HotelBrand[] {
  return sets
    .filter((set) => !set.is_default)
    .flatMap((set) => set.brand_names.map((name) => ({ name, family: set.name, ...(/\s/.test(name.trim()) ? {} : { nameOnly: true }) })));
}

/** Where a brand sits among the standards sets. */
export interface BrandPlacement<T extends BrandSetLike> {
  /** The brand as the form shows it and a negotiation records it. */
  brand: string;
  /** The set whose list holds the brand. Null means the default set. */
  set: T | null;
  /** The brand as it was written, when it is shown under another name. */
  written: string | null;
  /** The set of the brand's own family, when that set's list leaves the brand out. */
  leftOutOf: T | null;
}

/**
 * Places a brand, as read from a contract or typed by an associate.
 *
 * A set covers the brands on its list and no others. Its own name always
 * counts, so a brand recorded under the set's name finds the set again. A
 * brand on a list is shown as the set's name. A brand its family's set leaves
 * out is shown by its own name. A brand of a family with no set is shown as
 * the family. Null for a blank.
 */
export function placeBrand<T extends BrandSetLike>(brand: string | null | undefined, sets: T[]): BrandPlacement<T> | null {
  const typed = (brand ?? "").replace(BRAND_PLACES, " ").replace(/\s+/g, " ").trim();
  if (!typed) return null;

  const fallback = sets.find((set) => set.is_default);
  if (fallback && brandKey(typed) === brandKey(fallback.name)) return { brand: fallback.name, set: null, written: null, leftOutOf: null };

  const known = brandsIn(typed, { nameOnly: true, extra: setBrands(sets) })[0] ?? null;
  const name = known?.name ?? typed;
  const key = brandKey(name);
  const others = sets.filter((set) => !set.is_default);

  const covering = others.find((set) => brandKey(set.name) === key || set.brand_names.some((listed) => brandKey(listed) === key));
  if (covering) {
    return { brand: covering.name, set: covering, written: brandKey(typed) === brandKey(covering.name) ? null : typed, leftOutOf: null };
  }
  if (!known) return { brand: typed, set: null, written: null, leftOutOf: null };

  const familySet = others.find((set) => brandKey(set.name) === brandKey(known.family)) ?? null;
  if (familySet) return { brand: known.name, set: null, written: null, leftOutOf: familySet };
  return { brand: known.family, set: null, written: brandKey(typed) === brandKey(known.family) ? null : typed, leftOutOf: null };
}

/** The standards set a brand's reviews read, or null for the default set. */
export function setForBrand<T extends BrandSetLike>(brand: string | null | undefined, sets: T[]): T | null {
  return placeBrand(brand, sets)?.set ?? null;
}
