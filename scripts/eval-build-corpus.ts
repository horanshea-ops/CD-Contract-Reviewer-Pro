import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { draftEvalClauses, readBackEvalTerms } from "../lib/anthropic";
import { loadStandardsLibrary } from "../lib/standards/load";
import { EVAL_SPECS } from "../lib/eval/corpus/specs";
import { buildContract, CorpusIntegrityError } from "../lib/eval/corpus/draft";
import type { DraftedClause } from "../lib/eval/corpus/layout";
import { deriveKeyItems, resolveKeyItems } from "../lib/eval/corpus/derive-key";
import type { AnswerKey, AnswerKeyContract } from "../lib/eval/types";

/**
 * Builds the eval corpus and its answer key (MASTER_PLAN.md §2.0.1).
 *
 * Costs tokens. Every contract it writes is invented, and no CD client document
 * is read, written or referenced at any point.
 *
 * Run with no arguments to build the whole corpus, or `--only eval-03-bayfront`
 * to build one — worth doing first, to look at the prose before paying for the
 * rest.
 *
 * `--resume` reuses any contract whose drafted clauses are already on disk,
 * redrafting only what is missing. Each successful build writes those clauses
 * beside its DOCX for exactly that purpose: one contract failing at the end of
 * seven should not mean paying to redraft the six that succeeded. A reused
 * contract skips the read-back, which it already passed when it was written.
 */

const CORPUS_DIR = path.join("data", "sample-contracts", "eval");

/** Clauses an earlier successful build wrote, or null if there are none to reuse. */
async function readDraft(at: string): Promise<DraftedClause[] | null> {
  try {
    return JSON.parse(await readFile(at, "utf8")) as DraftedClause[];
  } catch {
    return null;
  }
}
const KEY_PATH = path.join("data", "eval", "synthetic-key-v1.json");

// Rates per million tokens, for reporting only.
const RATES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
};

function costOf(model: string, input: number, output: number): number | null {
  const rate = RATES[model];
  if (!rate) return null;
  return (input * rate.input + output * rate.output) / 1_000_000;
}

async function main() {
  const resume = process.argv.includes("--resume");
  const onlyAt = process.argv.indexOf("--only");
  const only = onlyAt === -1 ? null : process.argv[onlyAt + 1];
  const specs = only ? EVAL_SPECS.filter((s) => s.id === only) : EVAL_SPECS;

  if (specs.length === 0) {
    throw new Error(`No spec matches "${only}". Known ids: ${EVAL_SPECS.map((s) => s.id).join(", ")}`);
  }

  const standards = await loadStandardsLibrary();
  console.log(
    `Standards library: ${standards.entries.length} entries from ${standards.source}, version ${standards.version}\n`
  );

  await mkdir(CORPUS_DIR, { recursive: true });
  await mkdir(path.dirname(KEY_PATH), { recursive: true });

  const contracts: AnswerKeyContract[] = [];
  const totals = { input: 0, output: 0 };

  for (const spec of specs) {
    process.stdout.write(`${spec.id} ... `);
    const started = Date.now();

    try {
      const draftPath = path.join(CORPUS_DIR, `${spec.id}.draft.json`);
      const reuse = resume ? await readDraft(draftPath) : null;

      const built = await buildContract(
        spec,
        { draftClauses: draftEvalClauses, readBack: readBackEvalTerms },
        reuse ? { reuse } : {}
      );

      const file = `${spec.id}.docx`;
      await writeFile(path.join(CORPUS_DIR, file), built.bytes);
      await writeFile(draftPath, `${JSON.stringify(built.drafted, null, 2)}\n`);

      const items = resolveKeyItems(
        deriveKeyItems(spec, standards.entries).map((item) => ({ ...item, contract: file })),
        built.anchors
      );

      contracts.push({ contract: file, exhaustive: true, items });
      totals.input += built.tokens.input;
      totals.output += built.tokens.output;

      const words = built.extracted.parts.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
      console.log(
        `${reuse ? "reused" : "ok"} — ${(built.bytes.length / 1024).toFixed(0)}KB, ~${Math.round(words / 450)} pages, ` +
          `${built.anchors.length} anchors, ${items.length} key items, ${((Date.now() - started) / 1000).toFixed(0)}s`
      );
      for (const retry of built.retries) console.log(`     retried: ${retry}`);
    } catch (err) {
      if (err instanceof CorpusIntegrityError) {
        console.log(`REJECTED`);
        for (const failure of err.failures) console.log(`     ${failure}`);
        // Printed on failure too. They were only shown on success, so a
        // rejection said what finally went wrong and nothing about the four
        // attempts that led there.
        for (const retry of err.retries) console.log(`     retried: ${retry}`);
        // A contract that cannot be verified must not reach the corpus, and a
        // partial corpus keyed as exhaustive would score every missing
        // contract's findings as false positives.
        throw err;
      }
      throw err;
    }
  }

  if (!only) {
    const key: AnswerKey = {
      version: "synthetic-v1",
      source: "synthetic",
      standards_version: standards.version,
      generated_at: new Date().toISOString(),
      contracts,
    };
    await writeFile(KEY_PATH, `${JSON.stringify(key, null, 2)}\n`);
    console.log(`\nWrote ${KEY_PATH} — ${contracts.reduce((n, c) => n + c.items.length, 0)} key items.`);
  } else {
    console.log(`\nSingle-contract run, so ${KEY_PATH} was left alone.`);
  }

  const draftModel = process.env.EVAL_DRAFT_MODEL || "claude-haiku-4-5";
  const cost = costOf(draftModel, totals.input, totals.output);
  console.log(
    `Tokens — input ${totals.input.toLocaleString()}, output ${totals.output.toLocaleString()}` +
      (cost === null ? "" : ` (about $${cost.toFixed(2)} at ${draftModel} rates; read-back billed at Sonnet rates on top)`)
  );
}

main().catch((err) => {
  console.error(`\nCorpus build failed: ${err.message || err}`);
  process.exit(1);
});
