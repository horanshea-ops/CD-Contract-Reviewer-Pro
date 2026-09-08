import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { Document, SelectiveRevisionAcceptor } from "docxmlater";

/**
 * §1.3.1 part two — can docXMLater actually perform the §1.5 operation, and
 * does the §1.6.2 oracle hold afterwards?
 *
 * Round-tripping proved it does not destroy documents it merely opens. These
 * tests make it edit them, in the specific ways that break naive engines:
 * a replacement nested inside the counterparty's own insertion, a span
 * crossing runs with different formatting, and terms living in a header.
 */

const FIXTURES = path.join("tests", "fixtures");
const AUTHOR = "Jane Associate";

async function parts(buf: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) out[name] = await zip.file(name)!.async("string");
  }
  return out;
}

/** Text as the contract currently reads: plain runs + insertions, excluding deletions. */
function acceptedText(xml: string) {
  const stripped = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return [...stripped.matchAll(/<w:t[ >][^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function ok(label: string, pass: boolean, detail = "") {
  console.log(`   ${pass ? "  ok  " : " FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  return pass;
}

async function editTest(opts: {
  title: string;
  file: string;
  find: string;
  replace: string;
}) {
  console.log(`\n### ${opts.title}`);
  console.log(`    ${opts.file}: "${opts.find}" -> "${opts.replace}"`);

  const original = await readFile(path.join(FIXTURES, opts.file));
  const beforeParts = await parts(original);
  const beforeAccepted = acceptedText(beforeParts["word/document.xml"]);

  const doc = await Document.loadFromBuffer(original, { revisionHandling: "preserve" });
  const res = doc.findAndReplaceAll(opts.find, opts.replace, { trackChanges: true, author: AUTHOR });
  const out = await doc.toBuffer();
  const afterParts = await parts(out);
  const afterXml = afterParts["word/document.xml"];

  ok(`replacement applied (count=${res.count})`, res.count > 0);
  // Not a substring check: the library emits a minimal character diff, so
  // "seventy percent (70%)" is split across an insertion and an untouched run.
  // What matters is that accepting our revisions yields the replacement.
  const acceptedAfter = acceptedText(afterXml);
  ok("accepted view contains the replacement", acceptedAfter.includes(opts.replace),
     acceptedAfter.includes(opts.replace) ? "" : acceptedAfter.slice(0, 120));
  ok(`our author attributed`, afterXml.includes(`w:author="${AUTHOR}"`));

  // The counterparty's revisions must survive our edit.
  const beforeAuthors = new Set([...beforeParts["word/document.xml"].matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]));
  const afterAuthors = new Set([...afterXml.matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]));
  const lostAuthors = [...beforeAuthors].filter((a) => !afterAuthors.has(a));
  ok("counterparty revisions preserved", lostAuthors.length === 0, lostAuthors.length ? `lost: ${lostAuthors}` : "");

  // All parts still present — headers and footers must not be dropped.
  const lostParts = Object.keys(beforeParts).filter((k) => !(k in afterParts));
  ok("no parts dropped", lostParts.length === 0, lostParts.join(", "));

  // §1.6.2 oracle, author-scoped. A blanket reject-all would also reject the
  // counterparty's own pre-existing revisions, winding the document back past
  // what they actually sent us — so the check has to reject only OUR author.
  // The plan's wording ("rejecting all our changes") glosses over this.
  const rejected = await Document.loadFromBuffer(out, { revisionHandling: "preserve" });
  SelectiveRevisionAcceptor.rejectByAuthor(rejected, AUTHOR);
  const rejectedXml = (await parts(await rejected.toBuffer()))["word/document.xml"];
  const rejectedText = acceptedText(rejectedXml);
  const oracle = rejectedText === beforeAccepted;
  ok("reject-all returns the original", oracle);
  if (!oracle) {
    console.log(`          expected: ${beforeAccepted.slice(0, 130)}`);
    console.log(`          got     : ${rejectedText.slice(0, 130)}`);
  }
  return oracle;
}

async function headerTest() {
  console.log(`\n### Headers and footers — does the library even see them?`);
  const buf = await readFile(path.join(FIXTURES, "06-header-footer-terms.docx"));
  const before = await parts(buf);
  console.log("    parts in:", Object.keys(before).filter((k) => /header|footer/.test(k)).join(", ") || "(none)");

  const doc = await Document.loadFromBuffer(buf, { revisionHandling: "preserve" });
  // A cutoff term that exists ONLY in the header.
  const res = doc.findAndReplaceAll("thirty (30) days", "sixty (60) days", { trackChanges: true, author: AUTHOR });
  const out = await doc.toBuffer();
  const after = await parts(out);

  ok("header part survives round trip", "word/header1.xml" in after);
  ok("footer part survives round trip", "word/footer1.xml" in after);
  ok("header text still present", (after["word/header1.xml"] ?? "").includes("Room block cutoff"));
  ok(`header term reachable by findAndReplaceAll (count=${res.count})`, res.count > 0,
     res.count === 0 ? "header content is invisible to the edit API" : "");
}

async function main() {
  console.log("=".repeat(72));
  console.log("docXMLater 12.1.0 — §1.5 edit operations + §1.6.2 oracle");
  console.log("=".repeat(72));

  await editTest({
    title: "1. Baseline replacement in a clean contract",
    file: "01-clean-simple.docx",
    find: "eighty percent (80%)",
    replace: "seventy percent (70%)",
  });

  await editTest({
    title: "2. THE NESTED CASE (§1.5.7) — editing text the counterparty inserted",
    file: "03-tracked-one-author.docx",
    find: "night-by-night",
    replace: "cumulative",
  });

  await editTest({
    title: "3. Span crossing runs with different formatting (§1.5.4)",
    file: "04-tracked-two-authors.docx",
    find: "amount due is",
    replace: "total payable is",
  });

  await headerTest();
}

main().catch((e) => { console.error("\nTHREW:", e); process.exit(1); });
