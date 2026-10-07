import type { createAdminClient } from "../supabase/admin";
import { SET_COLUMNS, type StandardSet } from "./sets";

/**
 * The sets a review can read today: the default set, and every set that is
 * switched on and holds a standard in use. It is the loader's own rule
 * (lib/standards/load.ts), asked up front, so the upload screen offers only
 * what a review would actually use.
 *
 * The default set comes first. An empty list means the sets couldn't be read.
 */
export async function usableSets(db: ReturnType<typeof createAdminClient>): Promise<StandardSet[]> {
  const [sets, rows] = await Promise.all([
    db.from("standard_sets").select(SET_COLUMNS),
    db.from("standards").select("set_key").is("retired_at", null),
  ]);
  if (sets.error || rows.error) return [];

  const holding = new Set((rows.data ?? []).map((row) => row.set_key as string));
  return ((sets.data ?? []) as StandardSet[])
    .filter((set) => set.is_default || (set.is_active && holding.has(set.key)))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
}

/**
 * The set a new negotiation records, from what the associate confirmed at
 * upload. Null means the default set. A set that isn't usable is refused, so
 * a negotiation never names standards its reviews wouldn't read.
 */
export function confirmedSet(requested: string | null | undefined, usable: StandardSet[]): { set: string | null } | { error: string } {
  const key = requested?.trim();
  if (!key) return { set: null };

  const chosen = usable.find((set) => set.key === key);
  if (!chosen) return { error: "Those standards aren't available. Choose another set." };
  return { set: chosen.is_default ? null : chosen.key };
}
