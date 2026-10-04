import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readFile } from "fs/promises";
import { extractDocx } from "../lib/docx";
import { contractText } from "../lib/docx/contract-text";
import { attritionExposure, cancellationExposure, fbMinimumExposure } from "../lib/exposures/compute";
import { positionsFrom } from "../lib/exposures/cd-positions";
import { readFigures } from "../lib/exposures/figures";
import { EXPOSURE_CATALOG } from "../lib/review";
import { STANDARDS_LIBRARY } from "../lib/standards/v1";
import { extractTerms } from "../lib/terms/extract";

/**
 * Runs the reading call alone on one DOCX contract and prints the figures and
 * exposures it gives. Paid: one model call, about the contract's length in
 * input tokens. It checks the reader on a contract before a whole review is
 * paid for.
 *
 *   npx tsx scripts/read-figures.ts <contract.docx> [--model claude-sonnet-5]
 */

/** Dollars per million tokens. Both Sonnets cost the same. */
const RATE = { input: 2, output: 10, cache_write: 2.5, cache_read: 0.2 };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npx tsx scripts/read-figures.ts <contract.docx> [--model <id>]");
  const modelFlag = process.argv.indexOf("--model");
  const model = modelFlag === -1 ? undefined : process.argv[modelFlag + 1];

  const extracted = await extractDocx(new Uint8Array(await readFile(file)));
  const text = contractText(extracted);

  const started = Date.now();
  const { terms, model_id, tokens } = await extractTerms({
    document: { kind: "text", text },
    parts: extracted.parts,
    catalog: EXPOSURE_CATALOG,
    model,
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(0);

  const cost =
    (tokens.input * RATE.input + tokens.output * RATE.output + tokens.cache_creation * RATE.cache_write + tokens.cache_read * RATE.cache_read) /
    1_000_000;
  console.log(`${model_id}, ${seconds}s, ${tokens.input} in, ${tokens.output} out, ${tokens.cache_creation} cache write, $${cost.toFixed(3)}\n`);

  for (const term of terms.stated) {
    const value = typeof term.value === "object" ? JSON.stringify(term.value) : String(term.value);
    console.log(`${term.verification.padEnd(12)} ${term.term_key} = ${value}\n             "${term.quoted_text.slice(0, 140)}"`);
  }
  if (terms.not_stated.length > 0) console.log(`\nNot stated: ${terms.not_stated.join(", ")}`);
  if (terms.conflicts.length > 0) console.log(`Stated with more than one value: ${terms.conflicts.join(", ")}`);
  for (const rejected of terms.rejected) console.log(`Rejected ${rejected.term_key}: ${rejected.reason}`);

  const { figures, notes } = readFigures(terms);
  console.log("\nFigures:", JSON.stringify(figures, null, 2));
  for (const note of notes) console.log(`Note on ${note.term_key}: ${note.reason}`);

  // CD's numbers as the bundled library states them. A review uses the library in the database.
  const { positions } = positionsFrom(STANDARDS_LIBRARY);
  const exposures = {
    attrition: attritionExposure(figures, positions),
    cancellation: cancellationExposure(figures, positions),
    fb_minimum: fbMinimumExposure(figures, positions),
  };
  let total = 0;
  for (const [clause, exposure] of Object.entries(exposures)) {
    console.log(`${clause}: ${exposure ? `${exposure.amount.toLocaleString()}  (${exposure.formula})` : "no exposure"}`);
    total += exposure?.amount ?? 0;
  }
  console.log(`Total: ${total.toLocaleString()}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
