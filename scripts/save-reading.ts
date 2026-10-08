import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createAdminClient } from "../lib/supabase/admin";
import { HOTEL_TERM_CATALOG, catalogIndex } from "../lib/terms/catalog";

/**
 * Saves the reading stored with a review as a replay fixture. Free: it reads
 * the database and calls no model.
 *
 * A fixture holds the reader's answers with the contract's own words, so it
 * goes under data/private/, which git ignores. tests/readings-replay.test.ts
 * replays every fixture it finds there against the contract file named in it.
 *
 *   npx tsx scripts/save-reading.ts <analysis id> <contract.docx>
 */

const asWritten = (n: number) => Number((n * 100).toFixed(8));

async function main() {
  const [id, contract] = process.argv.slice(2);
  if (!id || !contract) throw new Error("Usage: npx tsx scripts/save-reading.ts <analysis id> <contract.docx>");

  const { data, error } = await createAdminClient().from("analyses").select("id, model_id, completed_at, term_extraction").eq("id", id).single();
  if (error || !data) throw new Error(`Could not load review ${id}: ${error?.message ?? "not found"}`);

  const stored = (data.term_extraction as { exposures?: { terms?: Record<string, unknown>[] } } | null)?.exposures?.terms;
  if (!stored) throw new Error(`Review ${id} has no stored reading. Reviews before 2026-10-03 kept none.`);

  // Stored values are checked values. Percentages go back to the way the reader wrote them.
  const index = catalogIndex(HOTEL_TERM_CATALOG);
  const entries = stored.map(({ term_key, value, quoted_text, source_section, confidence }) => {
    const def = index.get(term_key as string);
    const written =
      def?.kind === "number" && def.unit === "pct"
        ? asWritten(value as number)
        : def?.kind === "schedule"
          ? (value as { pct: number }[]).map((tier) => ({ ...tier, pct: asWritten(tier.pct) }))
          : value;
    return { term_key, value: written, quoted_text, source_section, confidence };
  });

  const dir = path.join("data", "private", "readings");
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `${id.slice(0, 8)}.json`);
  await writeFile(out, `${JSON.stringify({ analysis_id: data.id, contract, model_id: data.model_id, captured: data.completed_at?.slice(0, 10), entries }, null, 2)}\n`);
  console.log(`Wrote ${out} — ${entries.length} terms`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
