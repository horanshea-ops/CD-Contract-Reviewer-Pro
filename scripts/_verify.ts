import { readFile } from "node:fs/promises";
import { extractDocx } from "../lib/docx";
import { STANDARDS_LIBRARY } from "../lib/standards/v1";
import { SPEC_BY_ID } from "../lib/eval/corpus/specs";
import { deriveKeyItems } from "../lib/eval/corpus/derive-key";

async function main() {
  const id = process.argv[2];
  const spec = SPEC_BY_ID.get(id)!;
  const x = await extractDocx(new Uint8Array(await readFile(`data/sample-contracts/eval/${id}.docx`)));
  const words = x.parts.reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);
  console.log(`${id}: ${words} words, parts=${x.parts.map((p) => p.part).join(",")}`);
  console.log(`key items:`);
  for (const i of deriveKeyItems(spec, STANDARDS_LIBRARY)) {
    console.log(`  [${i.severity}/${i.kind}] ${i.clause_type} — ${i.rationale}`);
  }
  const at = x.document.text.indexOf(process.argv[3] ?? "# 2.");
  console.log("\n--- excerpt ---\n" + x.document.text.slice(at, at + 1500));
}
main();
