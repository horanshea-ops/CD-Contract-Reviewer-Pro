import { loadEnvLocal } from "./load-env";
import { generateRedline } from "../lib/redline-engine";
import { validateRedline } from "../lib/redline-validation";
import { UNAPPLIED_REASON_TEXT } from "../lib/redline-validation";
import { degradationRate, readRate } from "../lib/export-log";
import { FIXTURE_AUTHOR, FIXTURE_CORPUS, readFixture } from "../tests/helpers/fixture-corpus";

/**
 * §1.6.6 — the degradation rate, measured.
 *
 * "Measure this against the 12-fixture corpus before it is measured against
 * real contracts." The corpus run needs no database and is the number to watch
 * while §1.5 is built. The live section runs only when Supabase credentials are
 * present, and is what the weekly pilot review reads.
 */

loadEnvLocal();

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function corpus() {
  console.log("=".repeat(78));
  console.log(`Fixture corpus — ${FIXTURE_CORPUS.length} documents through the live engine and the oracle`);
  console.log("=".repeat(78));

  const counts = { clean: 0, partial: 0, fallback: 0 };
  const reasons = new Map<string, number>();

  for (const { file, findings } of FIXTURE_CORPUS) {
    const originalBytes = new Uint8Array(await readFixture(file));
    const engineResult = await generateRedline({
      originalDocxBytes: originalBytes,
      findings,
      author: FIXTURE_AUTHOR,
    });
    const report = await validateRedline({ originalBytes, engineResult, author: FIXTURE_AUTHOR });
    counts[report.outcome]++;
    for (const u of report.unapplied) reasons.set(u.reason, (reasons.get(u.reason) ?? 0) + 1);

    const applied = `applied=${report.appliedCount} unapplied=${report.unapplied.length}`;
    console.log(`${file.padEnd(34)} ${report.outcome.padEnd(9)} ${applied}`);
    if (report.fallbackReason) console.log(`    ${report.fallbackReason}`);
  }

  const rate = counts.fallback / FIXTURE_CORPUS.length;
  console.log("\n" + "-".repeat(78));
  console.log(`clean ${counts.clean} · partial ${counts.partial} · fallback ${counts.fallback}`);
  console.log(`Export fallback rate: ${pct(rate)} — ${readRate(rate, FIXTURE_CORPUS.length)}`);

  if (reasons.size) {
    console.log("\nWhy findings were not applied:");
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(count).padStart(3)}  ${reason} — ${UNAPPLIED_REASON_TEXT[reason as keyof typeof UNAPPLIED_REASON_TEXT]}`);
    }
  }
  return counts.fallback;
}

async function live() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log("\nNo Supabase credentials in the environment — skipping the live rate.");
    return;
  }
  const { createAdminClient } = await import("../lib/supabase/admin");
  const r = await degradationRate(createAdminClient());

  console.log("\n" + "=".repeat(78));
  console.log("Live — every completed analysis and DOCX export on record");
  console.log("=".repeat(78));
  console.log(`analyses ${r.analyses} (${r.intakePdfRouted} routed to PDF at intake)`);
  console.log(`exports  ${r.exports} — clean ${r.clean} · partial ${r.partial} · fallback ${r.fallback}`);
  console.log(`Combined degradation rate: ${pct(r.combinedRate)} — ${r.reading}`);
  if (r.reading === "not working") {
    console.log("Over 15%. The tracked-changes path does not exist in practice. Stop and address it.");
  }
  for (const { reason, count } of r.topReasons) console.log(`  ${String(count).padStart(3)}  ${reason}`);
}

async function main() {
  const fallbacks = await corpus();
  await live();
  // A fallback on a document we built ourselves means the corpus rate is not a
  // baseline any pilot number can be read against.
  process.exit(fallbacks === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("THREW:", e);
  process.exit(1);
});
