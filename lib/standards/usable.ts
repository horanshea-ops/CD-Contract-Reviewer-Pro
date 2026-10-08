import { placeBrand } from "../intake/brands";
import type { createAdminClient } from "../supabase/admin";
import { SET_COLUMNS, type StandardSet } from "./sets";

type Db = ReturnType<typeof createAdminClient>;

/** A set of standards as the upload screen needs it: which brands it is for, and whether a review can read it today. */
export interface BrandChoice {
  key: string;
  name: string;
  /** Brand names, as a contract writes them, that mean this set. */
  brand_names: string[];
  is_default: boolean;
  /**
   * True for the default set, and for a set that is switched on and holds a
   * standard in use. It is the loader's own rule (lib/standards/load.ts),
   * asked up front, so the upload screen can say which standards a review
   * will really read.
   */
  in_use: boolean;
}

async function setsWithUse(db: Db): Promise<(StandardSet & { in_use: boolean })[]> {
  const [sets, rows] = await Promise.all([
    db.from("standard_sets").select(SET_COLUMNS),
    db.from("standards").select("set_key").is("retired_at", null),
  ]);
  if (sets.error || rows.error) return [];

  const holding = new Set((rows.data ?? []).map((row) => row.set_key as string));
  return ((sets.data ?? []) as StandardSet[])
    .map((set) => ({ ...set, in_use: set.is_default || (set.is_active && holding.has(set.key)) }))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

/** Every brand, the default first. An empty list means the sets couldn't be read. */
export async function brandChoices(db: Db): Promise<BrandChoice[]> {
  return (await setsWithUse(db)).map(({ key, name, brand_names, is_default, in_use }) => ({ key, name, brand_names, is_default, in_use }));
}

/** The sets a review can read today, the default first. */
export async function usableSets(db: Db): Promise<StandardSet[]> {
  return (await setsWithUse(db)).filter((set) => set.in_use).map(({ in_use, ...set }) => (void in_use, set));
}

const MAX_BRAND_CHARS = 80;

/**
 * What a new negotiation records from the brand the associate confirmed at
 * upload: the brand as typed, and the standards set its reviews read. Null
 * for the set means the default.
 *
 * Any brand is recorded, since the hotel is that brand whether or not CD has
 * standards specific to it. A brand on a set's list is recorded under the
 * set's name (`placeBrand`). A brand whose set is switched off is recorded
 * with that set, and its reviews read the default one and say so.
 */
export function brandOnNegotiation(brand: string | null | undefined, choices: BrandChoice[]): { brand: string | null; set: string | null } {
  const placed = placeBrand(brand?.replace(/\s+/g, " ").trim().slice(0, MAX_BRAND_CHARS), choices);
  return { brand: placed?.brand ?? null, set: placed?.set?.key ?? null };
}
