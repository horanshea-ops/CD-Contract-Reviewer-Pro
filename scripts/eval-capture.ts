import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { analyzeContract } from "../lib/anthropic";
import { extractDocx } from "../lib/docx";
import { loadStandardsLibrary } from "../lib/standards/load";
import type { AnswerKey, RunDocument, RunRecord } from "../lib/eval/types";

/**
 * Runs the review pipeline over the eval corpus and records what came back
 * (MASTER_PLAN.md §2.0.1).
 *
 * Costs tokens. This is the step being measured, so it takes the same route a
 * real upload takes — DOCX extracted to text and sent as text, the docx_native
 * path in lib/analysis-pipeline.ts — rather than a converted PDF. Sending
 * something else here would measure a pipeline nobody uses.
 *
 * The run record stores findings and token counts, never document text. Scoring
 * re-extracts the DOCX, so a run cannot be scored against text that has drifted
 * from the file it came from.
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "synthetic-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "runs");

/**
 * Retries a failure that says nothing about the contract.
 *
 * DNS on this machine intermittently fails to resolve api.anthropic.com, and a
 * capture that gives up on the first one loses the whole run. A contract that
 * genuinely cannot be analysed still ends up recorded as failed, which is what
 * the scorer wants — its key items count as missed.
 */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let tries = 1; tries <= 4; tries++) {
    try {
      return await attempt();
    } catch (err) {
      last = err;
      console.log(`\n  attempt ${tries}/4 failed: ${err instanceof Error ? err.message : String(err)}`);
      if (tries < 4) await new Promise((resolve) => setTimeout(resolve, 10_000 * tries));
    }
  }
  throw last;
}

async function main() {
  const labelAt = process.argv.indexOf("--label");
  const label = labelAt === -1 ? new Date().toISOString().slice(0, 10) : process.argv[labelAt + 1];

  const modelAt = process.argv.indexOf("--model");
  const model = modelAt === -1 ? undefined : process.argv[modelAt + 1];

  const resume = process.argv.includes("--resume");

  // `--only <file>` captures one contract, for checking a prompt change against
  // the contract that shows it most sharply before paying for the whole corpus.
  // Scoring such a run reports every other contract as unanalysed, which is
  // correct — read that contract's own rows.
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt === -1 ? null : (process.argv[onlyAt + 1] ?? "").split(",").map((c) => c.trim());
  const key: AnswerKey = JSON.parse(await readFile(KEY_PATH, "utf8"));
  const standards = await loadStandardsLibrary();

  // Analyses an earlier attempt at this label already got. A dropped connection
  // should not mean paying to re-analyse the contracts that went through.
  const already = new Map<string, RunDocument>();
  if (resume) {
    try {
      const prior: RunRecord = JSON.parse(await readFile(path.join(RUNS_DIR, `${label}.json`), "utf8"));
      for (const d of prior.documents) if (d.analysis) already.set(d.contract, d);
    } catch {
      // No prior run under this label, so there is nothing to reuse.
    }
  }

  if (standards.version !== key.standards_version) {
    console.warn(
      `WARNING: the key was derived against ${key.standards_version} and this run will use ${standards.version}.\n` +
        `         The report will say so, but the comparison measures the model against positions it was not given.\n`
    );
  }

  console.log(
    `Standards library: ${standards.entries.length} entries from ${standards.source}, version ${standards.version}`
  );
  console.log(`Corpus: ${key.contracts.length} contracts from ${key.version}\n`);

  const documents: RunDocument[] = [];
  // Several contracts in one invocation share the cached standards library,
  // which the first call pays for and the rest read at a tenth of the price.
  const wanted = only ? key.contracts.filter((c) => only.includes(c.contract)) : key.contracts;
  if (wanted.length === 0) {
    throw new Error(
      `No contract named "${only?.join(", ")}" in the key. Known: ${key.contracts.map((c) => c.contract).join(", ")}`
    );
  }

  for (const entry of wanted) {
    process.stdout.write(`${entry.contract} ... `);
    const started = Date.now();

    const reused = already.get(entry.contract);
    if (reused) {
      documents.push(reused);
      console.log(`reused — ${reused.analysis!.findings.length} findings`);
      continue;
    }

    try {
      const bytes = await readFile(path.join(CORPUS_DIR, entry.contract));
      const extracted = await extractDocx(new Uint8Array(bytes));
      const text = extracted.parts.map((p) => p.text).join("\n\n");

      const analysis = await withRetry(() =>
        analyzeContract({
          document: { kind: "text", text },
          standards: standards.entries,
          standardsVersion: standards.version,
          model,
        })
      );

      const elapsed = Date.now() - started;
      documents.push({ contract: entry.contract, analysis, error: null, elapsed_ms: elapsed });
      console.log(
        `${analysis.findings.length} findings, ${analysis.clauses_checked.length} clauses checked, ` +
          `${(elapsed / 1000).toFixed(0)}s`
      );
    } catch (err) {
      // A failed document is recorded, never dropped. Scoring counts its key
      // items as missed, because a pipeline that cannot read a contract finds
      // nothing in it — which is a result.
      const message = err instanceof Error ? err.message : String(err);
      documents.push({ contract: entry.contract, analysis: null, error: message, elapsed_ms: Date.now() - started });
      console.log(`FAILED — ${message}`);
    }
  }

  const run: RunRecord = {
    run_id: label,
    created_at: new Date().toISOString(),
    model_id: documents.find((d) => d.analysis)?.analysis?.model_id ?? model ?? "unknown",
    standards_version: standards.version,
    standards_hash: standards.hash,
    documents,
  };

  await mkdir(RUNS_DIR, { recursive: true });
  const out = path.join(RUNS_DIR, `${label}.json`);
  await writeFile(out, `${JSON.stringify(run, null, 2)}\n`);

  const totals = documents.reduce(
    (acc, d) => ({
      input: acc.input + (d.analysis?.input_tokens ?? 0),
      output: acc.output + (d.analysis?.output_tokens ?? 0),
      cached: acc.cached + (d.analysis?.cache_read_input_tokens ?? 0),
    }),
    { input: 0, output: 0, cached: 0 }
  );

  console.log(`\nWrote ${out}`);
  console.log(
    `Tokens — input ${totals.input.toLocaleString()}, output ${totals.output.toLocaleString()}, ` +
      `cache read ${totals.cached.toLocaleString()}`
  );
  console.log(`Score it with: npm run eval:score -- --run ${label}`);
}

main().catch((err) => {
  console.error(`\nCapture failed: ${err.message || err}`);
  process.exit(1);
});
