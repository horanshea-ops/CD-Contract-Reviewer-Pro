/**
 * Hotel brands, as contracts write them, for reading a contract's brand by
 * local rules (lib/intake/read.ts).
 *
 * The brand shown to the associate is the hotel's brand family, whether or
 * not CD has standards specific to it. CD negotiates one set of standards per
 * family, so a family's lines are not told apart: Hyatt Regency is Hyatt, and
 * DoubleTree is Hilton. Which standards a review reads is answered by
 * `setForBrand`.
 *
 * `family` groups a brand with its parent. A `nameOnly` brand is also an
 * ordinary word or a person's name, so it is read from the property name or
 * the brand field and never from the body of the contract.
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

/** A standards set's own brand names as brands of that set, for names the list above lacks. */
export function setBrands(sets: BrandSetLike[]): HotelBrand[] {
  return sets.filter((set) => !set.is_default).flatMap((set) => set.brand_names.map((name) => ({ name, family: set.name })));
}

/**
 * The family a brand name belongs to, or null for a name no list has.
 * "Hyatt Regency" and "Andaz" are both Hyatt.
 */
export function familyOf(name: string | null | undefined, extra: HotelBrand[] = []): string | null {
  return brandsIn(name ?? "", { nameOnly: true, extra })[0]?.family ?? null;
}

/** A set of standards, as far as matching a brand to it goes. */
export interface BrandSetLike {
  key: string;
  name: string;
  brand_names: string[];
  is_default: boolean;
}

/**
 * The standards set a brand's reviews read, or null for the default set.
 *
 * A set covers its whole family. "DoubleTree by Hilton" is Hilton's by its
 * name, and "Conrad" is Hilton's by its family. A set's own name is its
 * family's name, so a brand read as "Kessler" finds the Kessler set.
 */
export function setForBrand<T extends BrandSetLike>(brand: string | null | undefined, sets: T[]): T | null {
  const name = (brand ?? "").replace(BRAND_PLACES, " ").trim();
  if (!name) return null;

  const family = familyOf(name, setBrands(sets));
  const names = family ? [name, family] : [name];
  const covers = (set: T) =>
    names.some((n) => n.toLowerCase() === set.name.toLowerCase()) || set.brand_names.some((b) => names.some((n) => wordOf(b).test(n)));
  return sets.find((set) => !set.is_default && covers(set)) ?? null;
}
