import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "../lib/docx";
import { HOTEL_TERM_CATALOG } from "../lib/terms/catalog";
import { reverify } from "../lib/terms/validate";
import { scoreTermsRun } from "../lib/eval/terms/score";
import { renderTermsReport } from "../lib/eval/terms/report";
import type { TermsKey, TermsRunRecord } from "../lib/eval/terms/types";

/**
 * Scores a captured term extraction run against a key (§2.0.2).
 *
 * Free and deterministic — no API key, no network. Each stored value is
 * re-verified against the re-extracted DOCX before scoring, so a checker fix
 * reaches old runs without paying to capture them again.
 *
 *   --run <label>    the run to score (required)
 *   --key <path>     a different key, such as a hand-written one; its runs are
 *                    read from beside it
 *   --corpus <dir>   where that key's contracts live (default: the eval corpus)
 *   --audit          print every term not scored correct, with its quote
 *   --json <path>    also write the full report as JSON
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "terms-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "terms-runs");

const argAfter = (flag: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

async function main() {
  const label = argAfter("--run");
  if (!label) throw new Error("Name the run to score: npm run eval:terms:score -- --run <label>");

  const keyPath = argAfter("--key") ?? KEY_PATH;
  const key: TermsKey = JSON.parse(await readFile(keyPath, "utf8"));
  const runsDir = argAfter("--key") ? path.join(path.dirname(keyPath), "terms-runs") : RUNS_DIR;
  const captured: TermsRunRecord = JSON.parse(await readFile(path.join(runsDir, `${label}.json`), "utf8"));
  const corpusDir = argAfter("--corpus") ?? CORPUS_DIR;

  let changed = 0;
  const documents = await Promise.all(
    captured.documents.map(async (doc) => {
      if (!doc.terms) return doc;
      const extracted = await extractDocx(new Uint8Array(await readFile(path.join(corpusDir, doc.contract))));
      const terms = reverify(doc.terms, HOTEL_TERM_CATALOG, extracted.parts);
      changed += terms.stated.filter((t, i) => t.verification !== doc.terms!.stated[i].verification).length;
      return { ...doc, terms };
    })
  );

  const report = scoreTermsRun({ key, run: { ...captured, documents }, catalog: HOTEL_TERM_CATALOG });

  const jsonPath = argAfter("--json");
  if (jsonPath) {
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote ${jsonPath}`);
  }
  if (changed > 0) console.log(`Re-verified against the DOCX: ${changed} stored values changed status since capture.\n`);
  process.stdout.write(renderTermsReport(report, { audit: process.argv.includes("--audit") }));
}

main().catch((err) => {
  console.error(`\nScoring failed: ${err.message || err}`);
  process.exit(1);
});
