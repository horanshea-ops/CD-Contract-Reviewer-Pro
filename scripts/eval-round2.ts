import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { Document, SelectiveRevisionAcceptor } from "docxmlater";

/**
 * §1.3 round two — five harder fixtures, chosen for the things real contracts
 * do that hand-built samples do not: Word's move tracking, multi-level
 * numbering, content controls and field codes, revisions inside table cells,
 * and the run splitting Word actually emits mid-word.
 */

const FIXTURES = path.join("tests", "fixtures");
const AUTHOR = "Jane Associate";

async function partsOf(buf: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  const out: Record<string, string> = {};
  for (const n of Object.keys(zip.files)) {
    if (n.endsWith(".xml") || n.endsWith(".rels")) out[n] = await zip.file(n)!.async("string");
  }
  return out;
}
function acceptedText(xml: string) {
  return [...xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "").matchAll(/<w:t[ >][^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((m) => m[1]).join("").replace(/\s+/g, " ").trim();
}
function say(pass: boolean, label: string, detail = "") {
  console.log(`   ${pass ? "  ok  " : " FAIL "} ${label}${detail ? "  — " + detail : ""}`);
  return pass;
}

interface Case {
  title: string;
  file: string;
  find: string;
  replace: string;
  /** True when §1.5.3 says the engine should refuse rather than edit. */
  shouldRefuse?: boolean;
  note?: string;
}

async function run(c: Case) {
  console.log(`\n### ${c.file}  —  ${c.title}`);
  console.log(`    "${c.find}" -> "${c.replace}"${c.note ? `   (${c.note})` : ""}`);

  const orig = await readFile(path.join(FIXTURES, c.file));
  const before = await partsOf(orig);
  const beforeXml = before["word/document.xml"];
  const beforeAccepted = acceptedText(beforeXml);
  const beforeAuthors = new Set([...beforeXml.matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]));

  let res: { count: number; revisions?: unknown[] };
  let out: Buffer;
  try {
    const doc = await Document.loadFromBuffer(orig, { revisionHandling: "preserve" });
    res = doc.findAndReplaceAll(c.find, c.replace, { trackChanges: true, author: AUTHOR });
    out = await doc.toBuffer();
  } catch (e) {
    say(false, "did not throw", (e as Error).message.slice(0, 90));
    return { fatal: true, forged: false };
  }

  const after = await partsOf(out);
  const afterXml = after["word/document.xml"];
  const ourCount = (afterXml.match(new RegExp(`w:author="${AUTHOR}"`, "g")) ?? []).length;

  console.log(`    findAndReplaceAll -> count=${res.count}, our revision elements=${ourCount}`);

  if (c.shouldRefuse) {
    // Editing here is not automatically wrong, but doing it untracked is.
    say(res.count === 0 || ourCount > 0, "did not edit protected content untracked",
      res.count > 0 && ourCount === 0 ? "edited a protected span with NO revision" : "");
  }

  // The defining question: if it changed text, is the change attributed to us?
  const edited = res.count > 0;
  const forged = edited && ourCount === 0;
  say(!forged, "our edit is tracked and attributed to us",
    forged ? "text changed but NO revision under our author" : edited ? "" : "(no match, nothing edited)");

  const lostAuthors = [...beforeAuthors].filter((a) => !afterXml.includes(`w:author="${a}"`));
  say(lostAuthors.length === 0, "counterparty revisions preserved", lostAuthors.join(", "));

  const lostParts = Object.keys(before).filter((k) => !(k in after));
  say(lostParts.length === 0, "no parts dropped", lostParts.join(", "));

  // Structure that must survive: numbering, content controls, fields, tables.
  const structure: Array<[string, RegExp]> = [
    ["numbering refs", /<w:numPr>/g],
    ["content controls", /<w:sdt>/g],
    ["field codes", /<w:instrText/g],
    ["tables", /<w:tbl>/g],
    ["move revisions", /<w:moveFrom\b|<w:moveTo\b/g],
  ];
  for (const [label, re] of structure) {
    const b = (beforeXml.match(re) ?? []).length;
    if (b === 0) continue;
    const a = (afterXml.match(re) ?? []).length;
    say(a === b, `${label} preserved`, a === b ? "" : `${b} -> ${a}`);
  }

  // §1.6.2 oracle, author-scoped.
  const rej = await Document.loadFromBuffer(out, { revisionHandling: "preserve" });
  SelectiveRevisionAcceptor.rejectByAuthor(rej, AUTHOR);
  const rejText = acceptedText((await partsOf(await rej.toBuffer()))["word/document.xml"]);
  const oracle = rejText === beforeAccepted;
  say(oracle, "reject-ours returns the input exactly");
  if (!oracle) {
    console.log(`          expected: ${beforeAccepted.slice(0, 120)}`);
    console.log(`          got     : ${rejText.slice(0, 120)}`);
  }
  return { fatal: false, forged };
}

const CASES: Case[] = [
  {
    file: "05-move-from-to.docx",
    title: "editing text inside a moveTo revision",
    find: "capped at the total contract value",
    replace: "capped at the total deposit paid",
    note: "control: text outside the move",
  },
  {
    file: "05-move-from-to.docx",
    title: "editing the moved clause itself",
    find: "indemnify Hotel against all claims",
    replace: "indemnify Hotel against third-party claims",
    note: "inside moveFrom/moveTo",
  },
  {
    file: "07-numbering-crossref.docx",
    title: "editing a numbered list item",
    find: "seventy percent (70%)",
    replace: "eighty percent (80%)",
  },
  {
    file: "08-content-controls-fields.docx",
    title: "editing a span inside a content control",
    find: "eighty percent (80%)",
    replace: "seventy percent (70%)",
    shouldRefuse: true,
    note: "§1.5.3 says refuse",
  },
  {
    file: "09-tracked-in-tables.docx",
    title: "editing inside a tracked change in a table cell",
    find: "seventy-five percent (75%)",
    replace: "sixty percent (60%)",
    note: "nested case, in a table",
  },
  {
    file: "10-word-run-splitting.docx",
    title: "phrase split across runs mid-word by Word",
    find: "eighty percent (80%)",
    replace: "seventy percent (70%)",
    note: "spans 4 runs + proofErr",
  },
];

async function main() {
  console.log("=".repeat(74));
  console.log("docXMLater 12.1.0 — round 2, five harder fixtures");
  console.log("=".repeat(74));
  const forged: string[] = [];
  for (const c of CASES) {
    const r = await run(c);
    if (r.forged) forged.push(`${c.file} (${c.title})`);
  }
  console.log("\n" + "=".repeat(74));
  console.log(forged.length === 0
    ? "No untracked/forged edits in round 2."
    : `UNTRACKED EDITS UNDER SOMEONE ELSE'S NAME in ${forged.length} case(s):\n  - ` + forged.join("\n  - "));
}
main().catch((e) => { console.error("THREW:", e); process.exit(1); });
