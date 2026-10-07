/**
 * Standards sets (CLAUDE.md deviation 10, migration 015).
 *
 * A set is one complete library of standards for a kind of hotel. CD has
 * pre-negotiated contracts with some brands, and a review of one of those
 * hotels reads that brand's set and nothing from any other.
 */

/** The catch-all set, and the one the bundled library stands in for. */
export const DEFAULT_SET = "independent";

export interface StandardSet {
  key: string;
  name: string;
  /** Brand names, as a contract writes them, that mean this set. */
  brand_names: string[];
  is_default: boolean;
  /** A set is used for reviews only once an admin switches it on. */
  is_active: boolean;
  source_document: string;
  source_date: string | null;
}

export const SET_COLUMNS = "key, name, brand_names, is_default, is_active, source_document, source_date";

/** A key as stored: lowercase letters, digits and underscores. */
export function isSetKey(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_]+$/.test(value);
}
