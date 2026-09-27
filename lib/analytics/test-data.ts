/**
 * TEST DATA for the Analytics tab. Delete this file, and the "test" branch in
 * source.ts, once real signed contracts are loaded.
 *
 * Every brand, property, client and associate name is invented. The cities
 * are real. Nothing here is written to the database. The generator is
 * seeded, so a given seed always gives the same records.
 *
 * The data carries patterns worth finding:
 * - The two Harborline brands never give on attrition.
 * - Nashville rates climb about 9% a year, against 3–4% elsewhere.
 * - Resorts hold their F&B minimums, and luxury brands hold resort fees.
 * - Luxury and some resort brands open lower on commission, at 7 or 8%.
 */

import { ANALYTICS_TERMS, NEGOTIATED_TERMS, type NumericTerm, type TermValue } from "./terms";
import type { AssociateRef, ContractRecord, ContractStatus, MarketTier, PropertyRecord, TermSnapshot } from "./types";

export const TEST_SEED = 20260927;

/** The generator's "today", fixed so tests and screenshots don't drift. */
export const TEST_AS_OF = "2026-09-27";

export interface TestDataOptions {
  seed?: number;
  /** Real associates to hand some contracts to, so access rules can be exercised. */
  realAssociates?: AssociateRef[];
  contracts?: number;
}

export interface TestDataset {
  properties: PropertyRecord[];
  contracts: ContractRecord[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BrandSpec {
  name: string;
  short: string;
  parent: string;
  tier: MarketTier;
  /** Chance, per negotiated term, that the hotel moves toward CD's ask. */
  flexibility: number;
  /** Terms this brand never moves on. */
  holds?: string[];
  /** The commission percentages this brand's first drafts offer. */
  commission: number[];
}

const BRANDS: BrandSpec[] = [
  { name: "Harborline Hotels", short: "Harborline", parent: "Northgate Hospitality", tier: "upper_upscale", flexibility: 0.55, holds: ["attrition.threshold"], commission: [10, 10, 8] },
  { name: "Harborline Grand", short: "Harborline Grand", parent: "Northgate Hospitality", tier: "convention", flexibility: 0.45, holds: ["attrition.threshold"], commission: [10] },
  { name: "Northgate Suites", short: "Northgate Suites", parent: "Northgate Hospitality", tier: "upscale", flexibility: 0.6, commission: [10, 8] },
  { name: "Crestmark Resorts", short: "Crestmark", parent: "Solstice Hotel Group", tier: "resort", flexibility: 0.4, commission: [7, 8, 8] },
  { name: "Solstice Hotels", short: "Solstice", parent: "Solstice Hotel Group", tier: "upscale", flexibility: 0.65, commission: [10, 10, 8] },
  { name: "Solace Collection", short: "Solace", parent: "Solstice Hotel Group", tier: "luxury", flexibility: 0.35, commission: [7, 7, 8] },
  { name: "Arden Hotels", short: "Arden", parent: "Arden & Pike Hotels", tier: "upper_upscale", flexibility: 0.6, commission: [10, 10, 10, 8] },
  { name: "Pike Grand", short: "Pike Grand", parent: "Arden & Pike Hotels", tier: "convention", flexibility: 0.5, commission: [10, 8] },
  { name: "Kestrel House", short: "Kestrel House", parent: "Kestrel Hospitality", tier: "upscale", flexibility: 0.7, commission: [10, 10] },
  { name: "Verano Collection", short: "Verano", parent: "Kestrel Hospitality", tier: "luxury", flexibility: 0.3, commission: [7, 8] },
  { name: "Tidewater Inns", short: "Tidewater", parent: "Tidewater Hotel Company", tier: "upscale", flexibility: 0.75, commission: [10, 8, 8] },
  { name: "Bluecoast Resorts", short: "Bluecoast", parent: "Tidewater Hotel Company", tier: "resort", flexibility: 0.45, commission: [8, 10] },
];

interface CitySpec {
  city: string;
  state: string;
  country: string;
  /** Upscale group rate in USD at the start of 2023. */
  rate: number;
  /** Yearly rate growth. */
  growth: number;
}

const CITIES: CitySpec[] = [
  { city: "Orlando", state: "FL", country: "United States", rate: 199, growth: 0.035 },
  { city: "Miami", state: "FL", country: "United States", rate: 259, growth: 0.04 },
  { city: "Tampa", state: "FL", country: "United States", rate: 189, growth: 0.035 },
  { city: "Las Vegas", state: "NV", country: "United States", rate: 179, growth: 0.03 },
  { city: "Chicago", state: "IL", country: "United States", rate: 229, growth: 0.03 },
  { city: "San Diego", state: "CA", country: "United States", rate: 249, growth: 0.035 },
  { city: "San Francisco", state: "CA", country: "United States", rate: 279, growth: 0.02 },
  { city: "Anaheim", state: "CA", country: "United States", rate: 219, growth: 0.035 },
  { city: "Palm Springs", state: "CA", country: "United States", rate: 239, growth: 0.04 },
  { city: "Nashville", state: "TN", country: "United States", rate: 209, growth: 0.09 },
  { city: "Phoenix", state: "AZ", country: "United States", rate: 189, growth: 0.035 },
  { city: "Scottsdale", state: "AZ", country: "United States", rate: 249, growth: 0.04 },
  { city: "Denver", state: "CO", country: "United States", rate: 209, growth: 0.035 },
  { city: "Austin", state: "TX", country: "United States", rate: 229, growth: 0.04 },
  { city: "Dallas", state: "TX", country: "United States", rate: 189, growth: 0.03 },
  { city: "San Antonio", state: "TX", country: "United States", rate: 179, growth: 0.03 },
  { city: "New Orleans", state: "LA", country: "United States", rate: 199, growth: 0.035 },
  { city: "Atlanta", state: "GA", country: "United States", rate: 199, growth: 0.03 },
  { city: "Washington", state: "DC", country: "United States", rate: 259, growth: 0.03 },
  { city: "Boston", state: "MA", country: "United States", rate: 289, growth: 0.035 },
  { city: "New York", state: "NY", country: "United States", rate: 319, growth: 0.035 },
  { city: "Seattle", state: "WA", country: "United States", rate: 239, growth: 0.03 },
  { city: "Charlotte", state: "NC", country: "United States", rate: 179, growth: 0.035 },
  { city: "Indianapolis", state: "IN", country: "United States", rate: 169, growth: 0.03 },
  { city: "Minneapolis", state: "MN", country: "United States", rate: 179, growth: 0.025 },
  { city: "Salt Lake City", state: "UT", country: "United States", rate: 169, growth: 0.035 },
  { city: "Kansas City", state: "MO", country: "United States", rate: 159, growth: 0.03 },
  { city: "Philadelphia", state: "PA", country: "United States", rate: 219, growth: 0.03 },
  { city: "Baltimore", state: "MD", country: "United States", rate: 189, growth: 0.03 },
  { city: "Honolulu", state: "HI", country: "United States", rate: 299, growth: 0.04 },
  { city: "Toronto", state: "ON", country: "Canada", rate: 229, growth: 0.03 },
  { city: "Vancouver", state: "BC", country: "Canada", rate: 249, growth: 0.035 },
  { city: "Cancún", state: "Quintana Roo", country: "Mexico", rate: 239, growth: 0.04 },
  { city: "London", state: "", country: "United Kingdom", rate: 309, growth: 0.03 },
];

const TIER_RATE: Record<MarketTier, number> = {
  upscale: 1,
  upper_upscale: 1.2,
  convention: 1.1,
  resort: 1.35,
  luxury: 1.75,
};

const TIER_ROOMS: Record<MarketTier, [number, number]> = {
  upscale: [180, 420],
  upper_upscale: [350, 900],
  convention: [900, 2000],
  resort: [300, 800],
  luxury: [200, 450],
};

const SUFFIXES = ["Downtown", "Waterfront", "Lakeside", "Convention Center", "Riverwalk", "Midtown", "Harbor", "Uptown", "Bayfront", "Plaza"];
const STREETS = ["Main Street", "Harbor Drive", "Convention Way", "Park Avenue", "Lake Shore Boulevard", "Market Street", "River Road", "Palm Avenue", "Grand Boulevard", "Bay Street"];

const CLIENTS = [
  "Midwest Dental Association", "Society for Applied Robotics", "Pacific Horticulture Council",
  "National Guild of Court Reporters", "Association of Regional Planners", "Coastal Engineering Society",
  "American Orchard Growers", "Federation of School Librarians", "Institute of Water Operators",
  "Northern Veterinary Alliance", "Society of Museum Registrars", "Council of Rural Hospitals",
  "Association of Transit Planners", "Guild of Stage Managers", "National Beekeeping Federation",
  "Society for Clinical Nutrition", "Association of Title Examiners", "Alliance of Craft Brewers",
  "Institute of Bridge Inspectors", "Council for Adult Literacy", "Association of Food Scientists",
  "Society of Hospital Pharmacists", "National Surveyors Guild", "Federation of Youth Orchestras",
  "Association of Fire Investigators",
];

const EVENT_KINDS = ["Annual Meeting", "Summit", "Conference", "Leadership Forum", "Expo"];

const FICTIONAL_ASSOCIATES: AssociateRef[] = [
  { id: "t-assoc-1", name: "Dana Whitfield" },
  { id: "t-assoc-2", name: "Marcus Oyelaran" },
  { id: "t-assoc-3", name: "Priya Natarajan" },
  { id: "t-assoc-4", name: "Tom Keller" },
];

/** How much each fictional associate adds to a hotel's willingness to move. */
const ASSOCIATE_SKILL: Record<string, number> = { "t-assoc-1": 1.2, "t-assoc-2": 1, "t-assoc-3": 1.1, "t-assoc-4": 0.8 };

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function generateTestData(options: TestDataOptions = {}): TestDataset {
  const rand = mulberry32(options.seed ?? TEST_SEED);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const chance = (p: number) => rand() < p;

  // Properties: 70, each a brand in a city, no name used twice. The first five are
  // upper-upscale Nashville hotels, so its rate rise has enough contracts to show.
  const properties: PropertyRecord[] = [];
  const brandOf = new Map<string, BrandSpec>();
  const cityOf = new Map<string, CitySpec>();
  const names = new Set<string>();
  const nashville = CITIES.find((c) => c.city === "Nashville")!;
  const upperUpscale = BRANDS.filter((b) => b.tier === "upper_upscale");
  while (properties.length < 70) {
    const seeded = properties.length < 5;
    const brand = seeded ? upperUpscale[properties.length % upperUpscale.length] : pick(BRANDS);
    const city = seeded ? nashville : pick(CITIES);
    const suffix = brand.tier === "convention" ? "Convention Center" : brand.tier === "resort" ? "Resort & Spa" : pick(SUFFIXES);
    const name = `${brand.short} ${city.city} ${suffix}`;
    if (names.has(name)) continue;
    names.add(name);
    const [lo, hi] = TIER_ROOMS[brand.tier];
    const id = `t-prop-${String(properties.length + 1).padStart(3, "0")}`;
    const record: PropertyRecord = {
      id,
      name,
      brand: brand.name,
      parentCompany: brand.parent,
      address: `${int(100, 9800)} ${pick(STREETS)}`,
      city: city.city,
      state: city.state,
      country: city.country,
      tier: brand.tier,
      guestRooms: Math.round(between(lo, hi) / 10) * 10,
    };
    properties.push(record);
    brandOf.set(id, brand);
    cityOf.set(id, city);
  }

  const weighted = [...properties, ...properties.slice(0, 5), ...properties.slice(0, 5)];

  const clients = CLIENTS.map((name, i) => ({ id: `t-client-${String(i + 1).padStart(2, "0")}`, name }));
  const real = options.realAssociates ?? [];

  const start = Date.parse("2023-01-02");
  const asOf = Date.parse(TEST_AS_OF);
  const count = options.contracts ?? 450;
  const contracts: ContractRecord[] = [];

  for (let n = 0; n < count; n++) {
    // The Nashville hotels come up three times as often.
    const property = pick(weighted);
    const brand = brandOf.get(property.id)!;
    const city = cityOf.get(property.id)!;
    const client = pick(clients);
    // The real associates get about one contract in eight each.
    const associate = real.length && chance(0.12 * real.length) ? pick(real) : pick(FICTIONAL_ASSOCIATES);
    const skill = ASSOCIATE_SKILL[associate.id] ?? 1;

    const openedMs = start + rand() * (asOf - start);
    const eventMs = openedMs + between(180, 900) * DAY;
    const nights = int(3, 5);
    const years = (eventMs - start) / (365 * DAY);

    const peak = Math.round((property.guestRooms * between(0.2, 0.7)) / 5) * 5;
    const roomNights = Math.round(peak * nights * between(0.7, 0.9));
    const baseRate = city.rate * TIER_RATE[property.tier] * Math.pow(1 + city.growth, years) * between(0.9, 1.1);
    const draftRate = Math.round(baseRate);

    // A term the contract doesn't state is left out, never set to zero or false.
    const stated = <T extends TermValue>(p: number, value: T): T | undefined => (chance(p) ? value : undefined);
    const resortish = property.tier === "resort" || property.tier === "luxury";

    const firstDraft = compact({
      "deal.group_rate_usd": draftRate,
      "deal.room_nights": stated(0.95, roomNights),
      "deal.peak_night_rooms": peak,
      "deal.fb_minimum_usd": stated(resortish || property.tier === "convention" ? 0.95 : 0.75, Math.round((roomNights * between(40, 110)) / 500) * 500),
      "attrition.threshold": stated(0.95, pick([80, 80, 85, 85, 90])),
      "cutoff_date.days_prior": stated(0.97, property.tier === "convention" ? pick([45, 60]) : pick([30, 30, 45])),
      "cancellation.top_tier_pct": stated(0.9, pick([90, 100, 100])),
      "rebates.comp_room_ratio": stated(0.85, pick([50, 50, 45])),
      "commission.commission_pct": stated(0.9, pick(brand.commission)),
      "mandatory_fees.resort_fee_usd": resortish ? stated(0.9, pick([25, 35, 45])) : stated(0.15, 20),
      "cancellation.resale_credit": stated(0.6, chance(0.4)),
      "force_majeure.covers_epidemic": stated(0.95, chance(0.35)),
      // A contract either promises rate parity or says nothing about it.
      "rate_parity.guaranteed": stated(0.25, true),
    });

    // CD asks for its standard wherever it has one, and a better number elsewhere.
    // A missing clause CD wants, such as rate parity, is asked for; a missing number isn't.
    const requested: TermSnapshot = { ...firstDraft };
    for (const term of NEGOTIATED_TERMS) {
      const draft = firstDraft[term.key];
      if (term.kind === "boolean") requested[term.key] = true;
      else if (draft === undefined) continue;
      else if (term.standard != null) requested[term.key] = term.better === "lower" ? Math.min(draft as number, term.standard) : Math.max(draft as number, term.standard);
      else if (term.key === "deal.group_rate_usd") requested[term.key] = Math.round((draft as number) * 0.9);
      else if (term.key === "deal.fb_minimum_usd") requested[term.key] = Math.round(((draft as number) * 0.8) / 500) * 500;
      else if (term.key === "cancellation.top_tier_pct") requested[term.key] = 75;
    }

    const ageDays = (asOf - openedMs) / DAY;
    const status: ContractStatus = ageDays < 120 && chance(0.7) ? "negotiating" : chance(0.08) ? "lost" : "signed";
    const rounds = status === "negotiating" ? int(1, 3) : int(2, 5);
    // A contract still in negotiation has had fewer rounds to move.
    const progress = status === "negotiating" ? rounds / 4 : 1;

    const final: TermSnapshot = { ...firstDraft };
    if (status !== "lost") {
      for (const term of NEGOTIATED_TERMS) {
        if (requested[term.key] === undefined || brand.holds?.includes(term.key)) continue;
        let p = brand.flexibility * skill * progress;
        if (term.key === "deal.fb_minimum_usd" && property.tier === "resort") p *= 0.15;
        if (term.key === "mandatory_fees.resort_fee_usd" && property.tier === "luxury") p *= 0.1;
        if (!chance(Math.min(p, 0.95))) continue;
        final[term.key] = moveToward(term, firstDraft[term.key], requested[term.key], chance(0.55) ? 1 : 0.5);
      }
    }

    const signedMs = status === "signed" ? Math.min(openedMs + rounds * between(8, 25) * DAY, asOf) : null;
    const year = new Date(eventMs).getUTCFullYear();

    contracts.push({
      id: `t-contract-${String(n + 1).padStart(4, "0")}`,
      source: "test",
      property,
      client,
      associate,
      eventName: `${client.name.replace(/^(Association|Society|Council|Federation|Institute|Guild|Alliance) (of|for) /, "")} ${pick(EVENT_KINDS)} ${year}`,
      eventStart: iso(eventMs),
      eventEnd: iso(eventMs + nights * DAY),
      openedAt: iso(openedMs),
      signedAt: signedMs == null ? null : iso(signedMs),
      status,
      firstDraft,
      requested,
      final,
      analysisId: null,
    });
  }

  contracts.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  return { properties, contracts };
}

function compact(snapshot: Record<string, TermValue | undefined>): TermSnapshot {
  return Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v !== undefined)) as TermSnapshot;
}

function moveToward(term: (typeof ANALYTICS_TERMS)[number], from: TermValue | undefined, to: TermValue, share: number): TermValue {
  if (term.kind === "boolean" || from === undefined) return to;
  const a = from as number;
  const b = to as number;
  const unit = (term as NumericTerm).unit;
  const step = unit !== "usd" ? 5 : term.key === "deal.fb_minimum_usd" ? 500 : 1;
  const moved = a + (b - a) * share;
  // Round away from the draft so a half move is still a move.
  const rounded = Math.round(moved / step) * step;
  return rounded === a ? b : rounded;
}

let cached: { key: string; data: TestDataset } | null = null;

/** The test dataset, built once per server process for a given set of real associates. */
export function testDataset(realAssociates: AssociateRef[] = []): TestDataset {
  const key = realAssociates.map((a) => a.id).join(",");
  if (!cached || cached.key !== key) cached = { key, data: generateTestData({ realAssociates }) };
  return cached.data;
}
