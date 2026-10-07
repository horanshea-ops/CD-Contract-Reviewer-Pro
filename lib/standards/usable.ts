import type { createAdminClient } from "../supabase/admin";
import { SET_COLUMNS, type StandardSet } from "./sets";

type Db = ReturnType<typeof createAdminClient>;

/** A brand an associate can pick at upload, and whether a review can read its standards today. */
export interface BrandChoice {
  key: string;
  name: string;
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
  return (await setsWithUse(db)).map(({ key, name, is_default, in_use }) => ({ key, name, is_default, in_use }));
}

/** The sets a review can read today, the default first. */
export async function usableSets(db: Db): Promise<StandardSet[]> {
  return (await setsWithUse(db)).filter((set) => set.in_use).map(({ in_use, ...set }) => (void in_use, set));
}

/**
 * The set a new negotiation records, from the brand the associate confirmed
 * at upload. Null means the default set.
 *
 * A brand whose standards aren't in use is recorded all the same, because the
 * hotel is still that brand. Its reviews read the default set and say so,
 * until an admin switches the brand's standards on.
 */
export function confirmedSet(requested: string | null | undefined, choices: BrandChoice[]): { set: string | null } | { error: string } {
  const key = requested?.trim();
  if (!key) return { set: null };

  const chosen = choices.find((choice) => choice.key === key);
  if (!chosen) return { error: "That brand isn't in the list. Choose another." };
  return { set: chosen.is_default ? null : chosen.key };
}
