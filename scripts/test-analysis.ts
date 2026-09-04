import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { readFile } from "fs/promises";
import path from "path";
import { analyzeContractPdf } from "../lib/anthropic";

/**
 * Headless proof-of-concept: run one sample contract through the pipeline
 * and print what comes back. No database, no UI — this is step 1 of the
 * build order, meant to answer one question: is the model any good at this?
 */

async function main() {
  const contractPath =
    process.argv[2] || path.join(process.cwd(), "data", "sample-contracts", "synthetic-sample-1.pdf");

  console.log(`Reading contract: ${contractPath}`);
  const pdfBytes = await readFile(contractPath);
  const pdfBase64 = pdfBytes.toString("base64");

  console.log("Sending to Claude for analysis... (this can take 30-90 seconds)");
  const start = Date.now();

  const result = await analyzeContractPdf({ pdfBase64 });

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s using ${result.model_id} (standards library ${result.standards_library_version})`);
  console.log(
    `Tokens — input: ${result.input_tokens}, output: ${result.output_tokens}, cache read: ${result.cache_read_input_tokens}, cache write: ${result.cache_creation_input_tokens}`
  );

  console.log(`\nClauses checked: ${result.clauses_checked.join(", ")}`);
  if (result.document_notes) {
    console.log(`Document notes: ${result.document_notes}`);
  }

  console.log(`\n${result.findings.length} finding(s):\n`);
  for (const [i, f] of result.findings.entries()) {
    console.log(`--- Finding ${i + 1} ---`);
    console.log(`Clause: ${f.clause_type}  |  Severity: ${f.severity}  |  Confidence: ${f.model_confidence}`);
    if (f.is_missing_clause) console.log(`(Clause is MISSING from the contract)`);
    if (f.exposure_amount != null) {
      console.log(`Exposure: $${f.exposure_amount.toLocaleString()} (${f.exposure_basis})`);
    }
    if (f.quoted_text) console.log(`Quoted text: "${f.quoted_text}"`);
    console.log(`Issue: ${f.finding_text}`);
    console.log(`CD standard: ${f.cd_standard}`);
    console.log(`Proposed language: ${f.proposed_language}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("\nAnalysis failed:", err.message || err);
  process.exit(1);
});
