import JSZip from "jszip";
import { generateTrackedChangesDocx } from "../lib/tracked-changes-docx";
import { validateRedline } from "../lib/redline-validation";
import type { MemoFinding } from "../lib/export-memo";
import { CONTENT_TYPES, DOC_RELS, ROOT_RELS, zipParts } from "../tests/helpers/docx-package";

/**
 * Randomised stress test for the live tracked-changes engine.
 *
 * Hand-built fixtures only probe the failures somebody already thought of.
 * This assembles documents from random combinations of the structures real
 * contracts contain — nested tables, merged cells, pre-existing revisions from
 * several authors, run splits mid-word, tabs, bookmarks, hyperlinks, fields,
 * content controls, smart punctuation — then picks its target the way the model
 * does: a random span of the document's *visible* text.
 *
 * Every run is seeded, so any failure reproduces with `--seed <n>`.
 *
 * The invariants are not defined here. Each document goes through
 * lib/redline-validation — the same oracle the export route runs at request
 * time — so a thousand randomised contracts test what actually ships rather
 * than a second implementation drifting alongside it.
 */

// --- seeded RNG ------------------------------------------------------------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CLAUSE_TEXT = [
  "Group shall be liable for eighty percent (80%) of the group rate for each unsold room night.",
  "Cancellation damages are fifty percent (50%) of anticipated room revenue.",
  "Attrition is measured cumulatively across the entire room block.",
  "The cutoff date is thirty (30) days prior to arrival.",
  "A mandatory resort fee of thirty-five dollars ($35.00) per room per night applies.",
  "Hotel shall use commercially reasonable efforts to resell unused rooms.",
  "Neither party is liable for failure to perform due to causes beyond its control.",
  "Group agrees to a room block of three hundred forty (340) rooms at $289.00 per night.",
  "Any food and beverage shortfall is billed at the contracted minimum.",
  "Deposits are due according to the schedule set out below.",
];
const HEADINGS = ["Attrition", "Cancellation", "Force Majeure", "Deposits", "Resort Fees", "Cutoff", "Indemnification"];
const AUTHORS = ["Dana Reyes", "Morgan Ellis", "Sam Okafor"];
const OUR_AUTHOR = "Jane Associate";

interface Ctx { rnd: () => number; nextId: () => number }
const pick = <T,>(c: Ctx, xs: T[]) => xs[Math.floor(c.rnd() * xs.length)];
const chance = (c: Ctx, p: number) => c.rnd() < p;

/** Emits text as one or more runs, sometimes splitting mid-word the way Word does. */
function runs(c: Ctx, text: string, rPr = ""): string {
  if (!text) return "";
  if (!chance(c, 0.45)) return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const cuts = 1 + Math.floor(c.rnd() * 3);
  const points = [0];
  for (let i = 0; i < cuts; i++) points.push(1 + Math.floor(c.rnd() * Math.max(1, text.length - 2)));
  points.push(text.length);
  points.sort((a, b) => a - b);
  let out = "";
  for (let i = 0; i < points.length - 1; i++) {
    const piece = text.slice(points[i], points[i + 1]);
    if (!piece) continue;
    out += `<w:r>${rPr}<w:t xml:space="preserve">${esc(piece)}</w:t></w:r>`;
    // Word litters these between runs; they have no w:t and must not shift offsets.
    if (chance(c, 0.25)) out += `<w:proofErr w:type="spellStart"/>`;
    if (chance(c, 0.15)) out += `<w:r><w:tab/></w:r>`;
    if (chance(c, 0.10)) out += `<w:bookmarkStart w:id="${800 + Math.floor(c.rnd() * 100)}" w:name="_b${i}"/>`;
  }
  return out;
}

function para(inner: string, pPr = "") { return `<w:p>${pPr}${inner}</w:p>`; }

/** A clause paragraph, sometimes carrying an existing revision from a counterparty. */
function clausePara(c: Ctx): string {
  const text = pick(c, CLAUSE_TEXT);
  if (!chance(c, 0.4)) return para(runs(c, text));

  const author = pick(c, AUTHORS);
  const date = "2026-02-14T10:30:00Z";
  const words = text.split(" ");
  const at = 1 + Math.floor(c.rnd() * Math.max(1, words.length - 2));
  const head = words.slice(0, at).join(" ") + " ";
  const tail = " " + words.slice(at).join(" ");
  const kind = c.rnd();
  if (kind < 0.4) {
    return para(runs(c, head) + `<w:ins w:id="${c.nextId()}" w:author="${esc(author)}" w:date="${date}">${runs(c, "revised language")}</w:ins>` + runs(c, tail));
  }
  if (kind < 0.75) {
    return para(runs(c, head) + `<w:del w:id="${c.nextId()}" w:author="${esc(author)}" w:date="${date}"><w:r><w:delText xml:space="preserve">struck language</w:delText></w:r></w:del>` + runs(c, tail));
  }
  // Both, the shape a real redline takes.
  return para(
    runs(c, head) +
      `<w:del w:id="${c.nextId()}" w:author="${esc(author)}" w:date="${date}"><w:r><w:delText xml:space="preserve">old wording</w:delText></w:r></w:del>` +
      `<w:ins w:id="${c.nextId()}" w:author="${esc(author)}" w:date="${date}">${runs(c, "new wording")}</w:ins>` +
      runs(c, tail)
  );
}

function cell(c: Ctx, inner: string, extraPr = "") {
  return `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/>${extraPr}</w:tcPr>${inner}</w:tc>`;
}

function table(c: Ctx, depth = 0): string {
  const cols = 2 + Math.floor(c.rnd() * 2);
  const rows = 2 + Math.floor(c.rnd() * 3);
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="2000"/>`).join("")}</w:tblGrid>`;
  let body = "";
  for (let r = 0; r < rows; r++) {
    let tr = "";
    for (let k = 0; k < cols; k++) {
      let inner: string;
      if (depth === 0 && chance(c, 0.12)) inner = table(c, depth + 1) + para(runs(c, ""));
      else inner = para(runs(c, pick(c, ["fifty percent (50%)", "seventy percent (70%)", "180 to 91", "Tier A", "$35.00", "ninety percent (90%)"])));
      const extraPr = r === 0 && k === 0 && chance(c, 0.2) ? `<w:vMerge w:val="restart"/>` : "";
      tr += cell(c, inner, extraPr);
    }
    body += `<w:tr>${tr}</w:tr>`;
  }
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${body}</w:tbl>`;
}

function sdtPara(c: Ctx) {
  return para(
    runs(c, "Group shall be liable for ") +
      `<w:sdt><w:sdtPr><w:alias w:val="Pct"/><w:id w:val="${9000 + Math.floor(c.rnd() * 100)}"/><w:text/></w:sdtPr><w:sdtContent>${runs(c, "eighty percent (80%)")}</w:sdtContent></w:sdt>` +
      runs(c, " of the group rate.")
  );
}

function fieldPara(c: Ctx) {
  return para(
    runs(c, "As described in ") +
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _x \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      runs(c, "Section 2.1") +
      `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
      runs(c, ", the parties agree.")
  );
}

function buildDocument(seed: number) {
  const rnd = mulberry32(seed);
  let id = 100 + Math.floor(rnd() * 500);
  const c: Ctx = { rnd, nextId: () => id++ };

  const sections: string[] = [para(runs(c, "HOTEL GROUP SALES AGREEMENT"), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`)];
  const n = 5 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    sections.push(para(runs(c, `${i + 1}. ${pick(c, HEADINGS)}`), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`));
    const kind = rnd();
    if (kind < 0.55) sections.push(clausePara(c));
    else if (kind < 0.78) sections.push(table(c));
    else if (kind < 0.9) sections.push(sdtPara(c));
    else sections.push(fieldPara(c));
    if (chance(c, 0.35)) sections.push(clausePara(c));
  }

  const body = sections.join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;
}

async function toDocx(xml: string) {
  return zipParts({
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "word/document.xml": xml,
    "word/_rels/document.xml.rels": DOC_RELS,
  });
}

// --- helpers ---------------------------------------------------------------
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** The contract as it currently reads. Used to pick targets and to confirm a redline landed. */
function acceptedText(xml: string) {
  const noDel = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return collapse([...noDel.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
}

/**
 * Pick a target the way the model does: a span *within one paragraph*. The
 * model quotes a clause, not text running across a heading into the next
 * section. An earlier version picked from the whole document's text, so nearly
 * every quote crossed a paragraph boundary and was refused — which passed, but
 * exercised only the refusal path and told us nothing about redlining.
 */
function paragraphTexts(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const noDel = m[1].replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
    // A paragraph inside a table cell still has its own boundary; that is fine,
    // the point is never to span two of them.
    const t = collapse([...noDel.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join(""));
    if (t) out.push(t);
  }
  return out;
}

function pickQuote(rnd: () => number, xml: string): string | null {
  const paras = paragraphTexts(xml).filter((t) => t.split(" ").length >= 5);
  if (!paras.length) return null;
  const para = paras[Math.floor(rnd() * paras.length)];
  const words = para.split(" ").filter(Boolean);
  const len = Math.max(2, Math.min(words.length, 3 + Math.floor(rnd() * 8)));
  const start = Math.floor(rnd() * Math.max(1, words.length - len + 1));
  return words.slice(start, start + len).join(" ");
}

export async function runOne(seed: number) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const beforeXml = buildDocument(seed);
  const bytes = await toDocx(beforeXml);
  const quote = pickQuote(rnd, beforeXml);
  if (!quote) return { seed, skipped: true, failures: [] as string[] };

  const findings: MemoFinding[] = [{
    clause_type: "attrition", severity: "high", is_missing_clause: false,
    quoted_text: quote, language: "NEGOTIATED REPLACEMENT LANGUAGE",
    finding_text: "x", cd_standard: "y",
  }];

  const failures: string[] = [];
  let out;
  try {
    out = await generateTrackedChangesDocx({ originalDocxBytes: bytes, findings, author: OUR_AUTHOR });
  } catch (e) {
    return { seed, skipped: false, quote, failures: [`engine threw: ${(e as Error).message.slice(0, 90)}`] };
  }

  const report = await validateRedline({
    originalBytes: bytes,
    engineResult: out,
    author: OUR_AUTHOR,
  });
  for (const check of report.checks) {
    if (!check.passed) failures.push(`${check.name}: ${check.detail}`);
  }

  // Not an oracle check: a gate that refused everything would satisfy every
  // invariant above while making the feature useless, so confirm the engine
  // did the work it reported doing.
  const afterXml = await (await JSZip.loadAsync(out.docxBytes)).file("word/document.xml")!.async("string");
  if (out.appliedCount > 0 && !acceptedText(afterXml).includes("NEGOTIATED REPLACEMENT LANGUAGE")) {
    failures.push("applied, but the replacement is not in the accepted view");
  }

  return {
    seed,
    skipped: false,
    quote,
    applied: out.appliedCount,
    unapplied: out.unapplied.length,
    outcome: report.outcome,
    failures,
  };
}

async function main() {
  const arg = process.argv.indexOf("--seed");
  const seeds = arg >= 0
    ? [Number(process.argv[arg + 1])]
    : Array.from({ length: Number(process.argv[2] ?? 10) }, (_, i) => Math.floor(Math.random() * 1e9));

  console.log("=".repeat(78));
  console.log(`Randomised stress test — ${seeds.length} generated contracts`);
  console.log("=".repeat(78));

  let failed = 0, appliedCount = 0;
  for (const seed of seeds) {
    const r = await runOne(seed);
    if (r.skipped) { console.log(`seed ${String(seed).padEnd(11)} skipped (document too short)`); continue; }
    const status = r.failures.length ? "FAIL" : " ok ";
    console.log(`seed ${String(seed).padEnd(11)} ${status}  ${String(r.outcome ?? "-").padEnd(8)} applied=${r.applied ?? 0} unapplied=${r.unapplied ?? 0}  quote: "${String(r.quote).slice(0, 46)}"`);
    for (const f of r.failures) console.log(`        ${f}`);
    if (r.failures.length) failed++;
    if ((r.applied ?? 0) > 0) appliedCount++;
  }

  console.log("\n" + "=".repeat(78));
  console.log(`${appliedCount}/${seeds.length} actually applied a redline (the rest were correctly refused).`);
  console.log(failed === 0 ? `All ${seeds.length} passed.` : `${failed}/${seeds.length} FAILED — reproduce with: npx tsx scripts/fuzz-tracked-changes.ts --seed <n>`);
  process.exit(failed ? 1 : 0);
}
// Only run the CLI when invoked directly; the regression test imports runOne.
if (process.argv[1]?.includes("fuzz-tracked-changes")) {
  main().catch((e) => { console.error("FUZZER THREW:", e); process.exit(1); });
}
