import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "../lib/docx";
import type { LocatablePart } from "../lib/redline-engine/locate";
import { scoreRun } from "../lib/eval/score";
import { renderReport } from "../lib/eval/report";
import type { AnswerKey, RunRecord } from "../lib/eval/types";

/**
 * Scores a captured run against the answer key (MASTER_PLAN.md §2.0.1).
 *
 * Free and deterministic — no API key, no network. Everything that needed a
 * model already happened in eval-capture, so the same run scored twice gives
 * the same report and a scoring change can be judged against a fixed run.
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "synthetic-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "runs");

function argAfter(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

async function main() {
  const label = argAfter("--run");
  if (!label) {
    throw new Error("Name the run to score: npm run eval:score -- --run <label>");
  }

  const keyPath = argAfter("--key") ?? KEY_PATH;
  const key: AnswerKey = JSON.parse(await readFile(keyPath, "utf8"));
  const run: RunRecord = JSON.parse(await readFile(path.join(RUNS_DIR, `${label}.json`), "utf8"));

  // Re-extracted, never read from the run record. A run that stored its own
  // text could be scored against wording the DOCX no longer contains, and the
  // spans in the key would point somewhere else entirely.
  const documents = new Map<string, LocatablePart[]>();
  for (const entry of key.contracts) {
    const bytes = await readFile(path.join(CORPUS_DIR, entry.contract));
    const extracted = await extractDocx(new Uint8Array(bytes));
    documents.set(
      entry.contract,
      extracted.parts.map((p) => ({ part: p.part, text: p.text }))
    );
  }

  const report = scoreRun({ key, run, documents });

  const jsonPath = argAfter("--json");
  if (jsonPath) {
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${jsonPath}`);
  }

  process.stdout.write(renderReport(report, { audit: process.argv.includes("--audit") }));
}

main().catch((err) => {
  console.error(`\nScoring failed: ${err.message || err}`);
  process.exit(1);
});
