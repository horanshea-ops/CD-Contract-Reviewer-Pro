import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createAdminClient } from "../lib/supabase/admin";
import { logAudit } from "../lib/audit";
import { STANDARDS_LIBRARY } from "../lib/standards/v1";

/**
 * Copies the bundled provisional compromise ranges into the live standards
 * table, then onto existing business findings that have none.
 *
 * Run once after migration 013. It fills only empty ranges, so it never
 * overwrites a range an admin has set, and each standard it fills is audited.
 *
 *   npx tsx scripts/fill-compromise-ranges.ts          # report only
 *   npx tsx scripts/fill-compromise-ranges.ts --apply  # write
 */

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createAdminClient();
  const bundled = new Map(STANDARDS_LIBRARY.map((s) => [s.clause_type, s.compromise_range]));

  const { data: rows, error } = await db
    .from("standards")
    .select("id, clause_type, category, compromise_range")
    .eq("category", "business")
    .is("retired_at", null);
  if (error) throw new Error(`Could not read standards: ${error.message}. Is migration 013 applied?`);

  const toFill = (rows ?? []).filter((r) => !r.compromise_range && bundled.get(r.clause_type));
  console.log(`${toFill.length} standards to fill:`, toFill.map((r) => r.clause_type).join(", ") || "none");

  if (apply) {
    for (const row of toFill) {
      const compromise_range = bundled.get(row.clause_type)!;
      const { error: updateError } = await db
        .from("standards")
        .update({ compromise_range, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("compromise_range", "");
      if (updateError) throw new Error(`Could not fill ${row.clause_type}: ${updateError.message}`);

      await logAudit({
        action: "standard_updated",
        entityType: "standard",
        entityId: row.id,
        metadata: { clause_type: row.clause_type, fields_changed: ["compromise_range"], source: "fill-compromise-ranges" },
      });
    }
  }

  // Existing business findings take the range their standard now has.
  const { data: live } = await db.from("standards").select("clause_type, compromise_range").eq("category", "business");
  let findingsFilled = 0;
  for (const s of live ?? []) {
    if (!s.compromise_range) continue;
    const query = db
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("category", "business")
      .eq("clause_type", s.clause_type)
      .eq("compromise_range", "");
    const { count } = await query;
    if (!count) continue;
    findingsFilled += count;
    if (apply) {
      const { error: findingError } = await db
        .from("findings")
        .update({ compromise_range: s.compromise_range })
        .eq("category", "business")
        .eq("clause_type", s.clause_type)
        .eq("compromise_range", "");
      if (findingError) throw new Error(`Could not fill findings for ${s.clause_type}: ${findingError.message}`);
    }
  }
  console.log(`${findingsFilled} existing business findings ${apply ? "filled" : "to fill"}.`);

  if (!apply) console.log("Report only. Run with --apply to write.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
