import { loadEnvLocal } from "./load-env";
import { diffRound } from "../lib/round-diff";

/**
 * §2.1.1 — what the property changed, printed for one round.
 *
 * `npm run diff:round -- <analysisId>` against the round that came back. This
 * is how the engine is checked against real contracts rather than against
 * documents we built ourselves.
 */

loadEnvLocal();

const clip = (s: string, n = 90) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/**
 * Named by what happened and where, not by where alone. "added — Signatures"
 * reads as though the signature clause changed, when a new clause was placed
 * after it.
 */
const PHRASE: Record<string, (where: string) => string> = {
  insert: (where) => `new text in ${where}`,
  delete: (where) => `removed from ${where}`,
  replace: (where) => `changed in ${where}`,
  move: (where) => `moved — ${where}`,
};

async function main() {
  const analysisId = process.argv[2];
  if (!analysisId) {
    console.error("Usage: npm run diff:round -- <analysisId>");
    process.exit(2);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("No Supabase credentials in the environment.");
    process.exit(2);
  }

  const { createAdminClient } = await import("../lib/supabase/admin");
  const result = await diffRound(createAdminClient(), analysisId);

  if (!result.ok) {
    console.log(result.reason);
    process.exit(1);
  }

  const { diff } = result;
  console.log("=".repeat(78));
  console.log(`Round ${diff.baselineRound} → round ${diff.returnedRound}`);
  console.log("=".repeat(78));
  console.log(`Baseline    ${diff.baselineSource} (${diff.confidence} confidence)`);
  console.log(`            ${diff.baselineExplanation}`);
  console.log(`Structure   read from ${diff.projector === "mapped" ? "the Word file" : "text alone"}`);
  console.log(`Unchanged   ${(diff.retained * 100).toFixed(1)}% of what we sent`);
  if (diff.attributionUnavailable) console.log(`No authors  ${diff.attributionUnavailable}`);

  if (diff.rebased) {
    console.log(
      "\nToo little of what we sent came back for a change-by-change reading to mean anything.\n" +
        "This looks like a different draft rather than an edit of ours."
    );
    process.exit(0);
  }

  console.log(`\n${diff.regions.length} change${diff.regions.length === 1 ? "" : "s"}\n`);
  for (const [i, region] of diff.regions.entries()) {
    const where = region.section
      ? [region.section.number, region.section.title].filter(Boolean).join(" ")
      : region.part ?? "document";
    const moved = region.section?.number !== region.baselineSection?.number && region.baselineSection?.number
      ? ` (was ${region.baselineSection.number})`
      : "";

    console.log(`${String(i + 1).padStart(3)}. ${PHRASE[region.kind](where)}${moved}`);
    if (region.cell) console.log(`     in table ${region.cell.tableIndex + 1}, cell ${region.cell.cellIndex + 1}`);
    if (region.baselineText) console.log(`     was:  ${clip(region.baselineText)}`);
    if (region.returnedText) console.log(`     now:  ${clip(region.returnedText)}`);
    if (region.authors.length) console.log(`     by:   ${region.authors.join(", ")}`);
  }

  if (diff.ourChanges.length) {
    console.log(`\nWhat became of the ${diff.ourChanges.length} change${diff.ourChanges.length === 1 ? "" : "s"} we made`);
    console.log("(text still present, not whether a finding was agreed — that is §2.1.2)\n");
    for (const change of diff.ourChanges) {
      const share = `${(change.retained * 100).toFixed(0)}% still there`;
      console.log(`     ${share.padEnd(18)} ${clip(change.text, 60)}`);
    }
  }
}

main().catch((e) => {
  console.error("THREW:", e);
  process.exit(1);
});
