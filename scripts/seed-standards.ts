import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createClient } from "@supabase/supabase-js";
import { STANDARDS_LIBRARY, STANDARDS_LIBRARY_VERSION } from "../lib/standards/v1";

/**
 * Loads the TypeScript standards library (lib/standards/v1.ts) into the
 * `standards` table, so the library has one source of truth in code and the
 * database just reflects it. Safe to re-run — upserts on (clause_type,
 * segment, version).
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

  const rows = STANDARDS_LIBRARY.map((entry) => ({
    clause_type: entry.clause_type,
    segment: entry.segment,
    position: entry.position,
    fallback_language: entry.fallback_language,
    walk_away_condition: entry.walk_away_condition,
    severity_default: entry.severity_default,
    version: entry.version,
    provenance: entry.provenance,
  }));

  const { data, error } = await supabase
    .from("standards")
    .upsert(rows, { onConflict: "clause_type,segment,version" })
    .select("clause_type");

  if (error) throw error;

  console.log(`Seeded ${data?.length ?? 0} standards entries (library version ${STANDARDS_LIBRARY_VERSION}).`);
}

main().catch((err) => {
  console.error("Seeding failed:", err.message || err);
  process.exit(1);
});
