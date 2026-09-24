import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "../lib/docx";
import type { LocatablePart } from "../lib/redline-engine/locate";
import { compareRuns } from "../lib/eval/compare";
import { redlineRun } from "../lib/eval/redline";
import { scoreRun } from "../lib/eval/score";
import { renderReport } from "../lib/eval/report";
import type { AnswerKey, RunRecord, ScoreReport } from "../lib/eval/types";

/**
 * Scores a captured run against the answer key (MASTER_PLAN.md §2.0.1).
 *
 * Free and deterministic — no API key, no network. Everything that needed a
 * model already happened in eval-capture, so the same run scored twice gives
 * the same report and a scoring change can be judged against a fixed run.
 *
 * Every score also marks up each contract with the run's findings, through the
 * live redline engine. Each `--baseline <label>` adds an earlier run to compare
 * against.
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "synthetic-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "runs");

function argAfter(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

function argsAfter(flag: string): string[] {
  return process.argv.flatMap((arg, i) => (arg === flag && process.argv[i + 1] ? [process.argv[i + 1]] : []));
}

const readRun = async (label: string): Promise<RunRecord> =>
  JSON.parse(await readFile(path.join(RUNS_DIR, `${label}.json`), "utf8"));

async function main() {
  const label = argAfter("--run");
  if (!label) {
    throw new Error("Name the run to score: npm run eval:score -- --run <label>");
  }

  const keyPath = argAfter("--key") ?? KEY_PATH;
  const key: AnswerKey = JSON.parse(await readFile(keyPath, "utf8"));
  const run = await readRun(label);

  // Re-extracted, never read from the run record. A run that stored its own
  // text could be scored against wording the DOCX no longer contains, and the
  // spans in the key would point somewhere else entirely.
  const documents = new Map<string, LocatablePart[]>();
  const originals = new Map<string, Uint8Array>();
  for (const entry of key.contracts) {
    const bytes = new Uint8Array(await readFile(path.join(CORPUS_DIR, entry.contract)));
    originals.set(entry.contract, bytes);
    const extracted = await extractDocx(bytes);
    documents.set(
      entry.contract,
      extracted.parts.map((p) => ({ part: p.part, text: p.text }))
    );
  }

  const score = async (r: RunRecord): Promise<ScoreReport> => ({
    ...scoreRun({ key, run: r, documents }),
    redline: await redlineRun(r, originals),
  });

  const report = await score(run);
  const baselines = argsAfter("--baseline");
  if (baselines.length > 0) {
    const earlier = await Promise.all(baselines.map(async (b) => score(await readRun(b))));
    report.comparison = compareRuns(report, earlier);
  }

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
