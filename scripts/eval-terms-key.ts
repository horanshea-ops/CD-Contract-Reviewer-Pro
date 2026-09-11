import { writeFile } from "node:fs/promises";
import path from "node:path";
import { EVAL_SPECS } from "../lib/eval/corpus/specs";
import { deriveTermsKey } from "../lib/eval/corpus/derive-terms-key";
import { HOTEL_TERM_CATALOG } from "../lib/terms/catalog";

/**
 * Writes the term extraction answer key from the eval specs (§2.0.2).
 *
 * Free and offline. tests/eval/terms-key.test.ts fails if the committed key
 * drifts from what this would write, so rerun it after changing a spec, the
 * layout or the catalog.
 */

const KEY_PATH = path.join("data", "eval", "terms-key-v1.json");

async function main() {
  const key = deriveTermsKey(EVAL_SPECS, HOTEL_TERM_CATALOG);
  await writeFile(KEY_PATH, `${JSON.stringify(key, null, 2)}\n`);

  const keyed = key.contracts.reduce((n, c) => n + Object.keys(c.terms).length, 0);
  console.log(`Wrote ${KEY_PATH} — ${key.contracts.length} contracts, ${keyed} keyed terms.`);
}

main().catch((err) => {
  console.error(`\nKey build failed: ${err.message || err}`);
  process.exit(1);
});
