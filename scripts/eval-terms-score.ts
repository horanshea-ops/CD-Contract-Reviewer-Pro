import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOTEL_TERM_CATALOG } from "../lib/terms/catalog";
import { scoreTermsRun } from "../lib/eval/terms/score";
import { renderTermsReport } from "../lib/eval/terms/report";
import type { TermsKey, TermsRunRecord } from "../lib/eval/terms/types";

/**
 * Scores a captured term extraction run against a key (§2.0.2).
 *
 * Free and deterministic — no API key, no network. Verification already ran at
 * capture time against the DOCX text, so this only compares values.
 *
 *   --run <label>   the run to score (required)
 *   --key <path>    a different key, such as a hand-written one
 *   --audit         print every term not scored correct, with its quote
 *   --json <path>   also write the full report as JSON
 */

const KEY_PATH = path.join("data", "eval", "terms-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "terms-runs");

const argAfter = (flag: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

async function main() {
  const label = argAfter("--run");
  if (!label) throw new Error("Name the run to score: npm run eval:terms:score -- --run <label>");

  const key: TermsKey = JSON.parse(await readFile(argAfter("--key") ?? KEY_PATH, "utf8"));
  const run: TermsRunRecord = JSON.parse(await readFile(path.join(RUNS_DIR, `${label}.json`), "utf8"));
  const report = scoreTermsRun({ key, run, catalog: HOTEL_TERM_CATALOG });

  const jsonPath = argAfter("--json");
  if (jsonPath) {
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${jsonPath}`);
  }
  process.stdout.write(renderTermsReport(report, { audit: process.argv.includes("--audit") }));
}

main().catch((err) => {
  console.error(`\nScoring failed: ${err.message || err}`);
  process.exit(1);
});
