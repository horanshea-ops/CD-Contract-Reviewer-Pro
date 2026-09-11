import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { extractDocx } from "../lib/docx";
import { contractText } from "../lib/docx/contract-text";
import { HOTEL_TERM_CATALOG } from "../lib/terms/catalog";
import { extractTerms } from "../lib/terms/extract";
import type { TermsKey, TermsRunDocument, TermsRunRecord } from "../lib/eval/terms/types";
import { withRetry } from "./with-retry";

/**
 * Runs term extraction over the eval corpus and records what came back (§2.0.2).
 *
 * COSTS TOKENS. It reads each contract exactly as an upload does — the DOCX
 * extracted and flattened by contractText — so the run measures the text
 * production sends. Scoring is separate and free: npm run eval:terms:score.
 *
 *   --label <name>        run name (default: today's date)
 *   --only a.docx,b.docx  a subset, for checking a change on one contract first
 *   --model <id>          e.g. claude-haiku-4-5, to compare against the default
 *   --resume              reuse contracts an earlier attempt at this label got
 *   --key <path>          a different key, such as a hand-written one; runs are
 *                         then written beside it rather than in data/eval/
 *   --corpus <dir>        where that key's contracts live (default: the eval corpus)
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "terms-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "terms-runs");

const argAfter = (flag: string) => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
};

async function main() {
  const label = argAfter("--label") ?? new Date().toISOString().slice(0, 10);
  const model = argAfter("--model") ?? undefined;
  const only = argAfter("--only")?.split(",").map((c) => c.trim()) ?? null;
  const corpusDir = argAfter("--corpus") ?? CORPUS_DIR;
  const keyPath = argAfter("--key") ?? KEY_PATH;
  const key: TermsKey = JSON.parse(await readFile(keyPath, "utf8"));
  // A run holds quotes from its contracts, so a hand key's runs stay beside it,
  // inside data/private/, and never need moving before a commit.
  const runsDir = argAfter("--key") ? path.join(path.dirname(keyPath), "terms-runs") : RUNS_DIR;
  const outPath = path.join(runsDir, `${label}.json`);

  const already = new Map<string, TermsRunDocument>();
  if (process.argv.includes("--resume")) {
    try {
      const prior: TermsRunRecord = JSON.parse(await readFile(outPath, "utf8"));
      for (const d of prior.documents) if (d.terms) already.set(d.contract, d);
    } catch {
      // No earlier attempt at this label, so nothing to reuse.
    }
  }

  const wanted = only ? key.contracts.filter((c) => only.includes(c.contract)) : key.contracts;
  if (wanted.length === 0) {
    throw new Error(`No contract named "${only?.join(", ")}" in the key. Known: ${key.contracts.map((c) => c.contract).join(", ")}`);
  }
  console.log(`Catalog ${HOTEL_TERM_CATALOG.version}, ${HOTEL_TERM_CATALOG.terms.length} terms. ${wanted.length} contracts.\n`);

  const documents: TermsRunDocument[] = [];
  let modelId = model ?? "unknown";

  for (const entry of wanted) {
    process.stdout.write(`${entry.contract} ... `);
    const reused = already.get(entry.contract);
    if (reused) {
      documents.push(reused);
      console.log(`reused — ${reused.terms!.stated.length} stated`);
      continue;
    }

    const started = Date.now();
    try {
      const extracted = await extractDocx(new Uint8Array(await readFile(path.join(corpusDir, entry.contract))));
      const outcome = await withRetry(() =>
        extractTerms({ document: { kind: "text", text: contractText(extracted) }, parts: extracted.parts, model })
      );
      modelId = outcome.model_id;
      documents.push({ contract: entry.contract, terms: outcome.terms, error: null, tokens: outcome.tokens, elapsed_ms: Date.now() - started });

      const t = outcome.terms;
      console.log(
        `${t.stated.length} stated, ${t.rejected.length} rejected, ${t.conflicts.length} conflicts, ` +
          `${outcome.tokens.output} output tokens, ${((Date.now() - started) / 1000).toFixed(0)}s`
      );
    } catch (err) {
      // Recorded, never dropped: a contract the pass cannot read scores as missed.
      const message = err instanceof Error ? err.message : String(err);
      documents.push({ contract: entry.contract, terms: null, error: message, tokens: null, elapsed_ms: Date.now() - started });
      console.log(`FAILED — ${message}`);
    }
  }

  const run: TermsRunRecord = {
    run_id: label,
    created_at: new Date().toISOString(),
    model_id: modelId,
    catalog_version: HOTEL_TERM_CATALOG.version,
    documents,
  };
  await mkdir(runsDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`);

  const sum = (k: "input" | "output" | "cache_read") => documents.reduce((n, d) => n + (d.tokens?.[k] ?? 0), 0);
  console.log(`\nWrote ${outPath}`);
  console.log(`Tokens — input ${sum("input").toLocaleString()}, output ${sum("output").toLocaleString()}, cache read ${sum("cache_read").toLocaleString()}`);
  console.log(`Score it with: npm run eval:terms:score -- --run ${label}`);
}

main().catch((err) => {
  console.error(`\nCapture failed: ${err.message || err}`);
  process.exit(1);
});
