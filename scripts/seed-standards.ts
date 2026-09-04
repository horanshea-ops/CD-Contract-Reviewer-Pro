import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createClient } from "@supabase/supabase-js";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "../lib/standards/v1";

/**
 * Loads the TypeScript standards library (lib/standards/v1.ts) into the
 * `standards` table. Only meant as the initial stage-1 bootstrap — once the
 * admin screen exists, the database is the live source of truth, and this
 * must never silently overwrite an admin's edits. So: only touches rows
 * that don't exist yet, or that are still untouched industry_default
 * entries. Anything promoted to extracted/cd_validated, or already edited,
 * is left alone.
 */

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local"
    );
  }

  const supabase = createClient(url, serviceKey);

  const { data: existing, error: fetchError } = await supabase
    .from("standards")
    .select("clause_type, segment, provenance");
  if (fetchError) throw fetchError;

  const existingByKey = new Map(
    (existing ?? []).map((row) => [`${row.clause_type}::${row.segment}`, row.provenance])
  );

  const rows = STANDARDS_LIBRARY.filter((entry) => {
    const key = `${entry.clause_type}::${entry.segment}`;
    const currentProvenance = existingByKey.get(key);
    return currentProvenance === undefined || currentProvenance === "industry_default";
  }).map((entry) => ({
    clause_type: entry.clause_type,
    segment: entry.segment,
    position: entry.position,
    fallback_language: entry.fallback_language,
    walk_away_condition: entry.walk_away_condition,
    severity_default: entry.severity_default,
    version: entry.version,
    provenance: entry.provenance,
  }));

  const skipped = STANDARDS_LIBRARY.length - rows.length;

  if (rows.length === 0) {
    console.log(`Nothing to seed — all ${STANDARDS_LIBRARY.length} entries already exist and have been edited or validated.`);
    return;
  }

  const { data, error } = await supabase
    .from("standards")
    .upsert(rows, { onConflict: "clause_type,segment,version" })
    .select("clause_type");

  if (error) throw error;

  console.log(`Seeded ${data?.length ?? 0} standards entries (library version ${STANDARDS_LIBRARY_VERSION}).`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} entries already promoted beyond industry_default — not overwritten.`);
  }
}

main().catch((err) => {
  console.error("Seeding failed:", err.message || err);
  process.exit(1);
});
