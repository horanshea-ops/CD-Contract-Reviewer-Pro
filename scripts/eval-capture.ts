import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { MODEL_CALL_BUDGET_MS } from "../lib/analysis-status";
import type { AnswerOptions } from "../lib/anthropic";
import { extractDocx } from "../lib/docx";
import { contractText } from "../lib/docx/contract-text";
import { standardsMismatch } from "../lib/eval/score";
import { reviewContract } from "../lib/review";
import { loadStandardsLibrary } from "../lib/standards/load";
import type { AnswerKey, RunDocument, RunRecord } from "../lib/eval/types";
import { costOf, withRetry } from "./with-retry";

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
 *
 * Each call gets the app's own time limit, and one try. A call left to wait
 * retries on its own and bills each time, with nobody watching. `--retries <n>`
 * allows more tries for a run with funds behind it. The run stops at the first
 * contract that fails, and prints what each contract cost.
 */

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");
const KEY_PATH = path.join("data", "eval", "synthetic-key-v1.json");
const RUNS_DIR = path.join("data", "eval", "runs");

async function main() {
  const labelAt = process.argv.indexOf("--label");
  const label = labelAt === -1 ? new Date().toISOString().slice(0, 10) : process.argv[labelAt + 1];

  const modelAt = process.argv.indexOf("--model");
  const model = modelAt === -1 ? undefined : process.argv[modelAt + 1];

  const resume = process.argv.includes("--resume");

  // `--effort <level>` and `--thinking adaptive` give the judging call a
  // setting other than the app's, to measure it. The run record says which.
  const effortAt = process.argv.indexOf("--effort");
  const effort = effortAt === -1 ? undefined : process.argv[effortAt + 1];
  if (effort !== undefined && !EFFORTS.includes(effort as Effort)) {
    throw new Error(`--effort takes one of ${EFFORTS.join(", ")}`);
  }
  const thinkingAt = process.argv.indexOf("--thinking");
  const thinking = thinkingAt === -1 ? undefined : process.argv[thinkingAt + 1];
  if (thinking !== undefined && thinking !== "adaptive" && thinking !== "off") {
    throw new Error("--thinking takes adaptive or off");
  }
  const answer: AnswerOptions | undefined = effort || thinking ? { effort: effort as Effort | undefined, thinking } : undefined;

  const retriesAt = process.argv.indexOf("--retries");
  const tries = retriesAt === -1 ? 1 : Math.max(1, Number(process.argv[retriesAt + 1]) || 1);

  // `--only <file>` captures one contract, for checking a prompt change against
  // the contract that shows it most sharply before paying for the whole corpus.
  // Scoring such a run reports every other contract as unanalysed, which is
  // correct — read that contract's own rows.
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt === -1 ? null : (process.argv[onlyAt + 1] ?? "").split(",").map((c) => c.trim());
  const key: AnswerKey = JSON.parse(await readFile(KEY_PATH, "utf8"));
  const standards = await loadStandardsLibrary();

  // A paid run on the bundled copy measures a library the app doesn't use.
  if (standards.source === "bundled_fallback" && !process.argv.includes("--bundled")) {
    throw new Error(
      `The standards library came from the bundled copy, not the database (${standards.fallbackReason}). ` +
        `Nothing was sent. Pass --bundled to run on the bundled copy on purpose.`
    );
  }

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

  const mismatch = standardsMismatch(key, { standards_version: standards.version, standards_hash: standards.hash });
  if (mismatch) {
    console.warn(
      `WARNING: ${mismatch}.\n` +
        `         The report will say so, but the comparison measures the model against positions it was not given.\n`
    );
  }

  console.log(
    `Standards library: ${standards.entries.length} entries from ${standards.source}, version ${standards.version}`
  );
  console.log(`Corpus: ${key.contracts.length} contracts from ${key.version}\n`);

  const documents: RunDocument[] = [];
  let spent = 0;
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
      const text = contractText(extracted);

      const analysis = await withRetry(
        () =>
          reviewContract({
            document: { kind: "text", text },
            standards: standards.entries,
            standardsVersion: standards.version,
            model,
            parts: extracted.parts,
            answer,

            // The limit a review gets in the app, counted from this try.
            deadline: Date.now() + MODEL_CALL_BUDGET_MS,
          }),
        tries
      );

      const elapsed = Date.now() - started;
      documents.push({ contract: entry.contract, analysis, error: null, elapsed_ms: elapsed });
      const reading = analysis.reading.ok ? analysis.reading.tokens : null;
      const again = analysis.follow_up?.tokens ?? null;
      const cost = costOf({
        input: analysis.input_tokens + (reading?.input ?? 0) + (again?.input ?? 0),
        output: analysis.output_tokens + (reading?.output ?? 0) + (again?.output ?? 0),
        cacheRead: (analysis.cache_read_input_tokens ?? 0) + (reading?.cache_read ?? 0) + (again?.cache_read ?? 0),
        cacheWrite: (analysis.cache_creation_input_tokens ?? 0) + (reading?.cache_creation ?? 0) + (again?.cache_creation ?? 0),
      });
      spent += cost;
      console.log(
        `${analysis.findings.length} findings, ${analysis.clauses_checked.length} clauses checked, ` +
          `${analysis.review_gaps.length} gaps, ${analysis.dropped_findings.length} dropped, ` +
          `${(elapsed / 1000).toFixed(0)}s, ${cost.toFixed(3)}`
      );
      for (const gap of analysis.review_gaps) console.log(`    gap: ${gap.kind} ${gap.clause_type}`);
      console.log(`    judging call: ${analysis.output_tokens.toLocaleString()} output tokens, ${(analysis.thinking_tokens ?? 0).toLocaleString()} of them thinking`);
      if (analysis.follow_up) {
        const { asked_for, findings_added, error } = analysis.follow_up;
        console.log(`    asked again for ${asked_for.join(", ")}: ${error ?? `${findings_added} findings`}`);
      }
    } catch (err) {
      // A failed document is recorded, never dropped. Scoring counts its key
      // items as missed, because a pipeline that cannot read a contract finds
      // nothing in it — which is a result.
      const message = err instanceof Error ? err.message : String(err);
      documents.push({ contract: entry.contract, analysis: null, error: message, elapsed_ms: Date.now() - started });
      console.log(`FAILED after ${((Date.now() - started) / 1000).toFixed(0)}s — ${message}`);

      // A failure may be the service or the network, and the next contract would pay to find out.
      console.log("Stopping here. The contracts not reached are left out of this run.");
      break;
    }
  }

  const run: RunRecord = {
    run_id: label,
    created_at: new Date().toISOString(),
    model_id: documents.find((d) => d.analysis)?.analysis?.model_id ?? model ?? "unknown",
    standards_version: standards.version,
    standards_hash: standards.hash,
    ...(answer ? { settings: { effort, thinking } } : {}),
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
  console.log(`Cost of the calls that returned: ${spent.toFixed(3)}`);
  console.log(`Score it with: npm run eval:score -- --run ${label}`);
}

main().catch((err) => {
  console.error(`\nCapture failed: ${err.message || err}`);
  process.exit(1);
});
