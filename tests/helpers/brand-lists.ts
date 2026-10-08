import { readFileSync } from "node:fs";

/**
 * The two starting brand lists, read from migration 017, so a test compares a
 * brand with the same lists the database is given.
 */
function listFor(key: string): string[] {
  const sql = readFileSync("supabase/migrations/017_set_brand_lists.sql", "utf8");
  const update = sql.split(/^update standard_sets$/m).find((block) => block.includes(`where key = '${key}'`));
  if (!update) throw new Error(`Migration 017 has no list for ${key}.`);
  return [...update.slice(0, update.indexOf("where key")).matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

export const HILTON_BRANDS = listFor("hilton");
export const HYATT_BRANDS = listFor("hyatt");
