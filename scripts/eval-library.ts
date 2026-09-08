import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { Document } from "docxmlater";

/**
 * MASTER_PLAN.md §1.3.1 — evaluate docXMLater against contracts that already
 * contain tracked changes, before committing the whole schedule to it.
 *
 * The questions that matter are not "does it have an API" but:
 *   1. Does a load/save round trip preserve the counterparty's revisions?
 *   2. What does the DEFAULT do — the README says it accepts changes, which
 *      would silently destroy a counterparty redline.
 *   3. Does document content survive unchanged (the §1.6.2 oracle)?
 *   4. Do tables and mixed run formatting survive?
 */

const FIXTURES = path.join("tests", "fixtures");

interface Shape {
  ins: number;
  del: number;
  delText: number;
  tables: number;
  rows: number;
  bold: number;
  italic: number;
  authors: string[];
  text: string;
  xmlLength: number;
}

async function shapeOf(buf: Buffer | Uint8Array): Promise<Shape> {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("no word/document.xml");
  const xml = await f.async("string");
  const textOnly = [...xml.matchAll(/<w:t[ >][^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("");
  return {
    ins: (xml.match(/<w:ins\b/g) ?? []).length,
    del: (xml.match(/<w:del\b/g) ?? []).length,
    delText: (xml.match(/<w:delText\b/g) ?? []).length,
    tables: (xml.match(/<w:tbl>/g) ?? []).length,
    rows: (xml.match(/<w:tr\b/g) ?? []).length,
    // Match any form: docXMLater re-emits <w:b/> as <w:b w:val="1"/>, which is
    // semantically identical. A /<w:b\/>/ regex reports that as lost formatting
    // and nearly disqualified the library on a false alarm.
    bold: (xml.match(/<w:b[ \/>]/g) ?? []).length,
    italic: (xml.match(/<w:i[ \/>]/g) ?? []).length,
    authors: [...new Set([...xml.matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]))].sort(),
    text: textOnly.replace(/\s+/g, " ").trim(),
    xmlLength: xml.length,
  };
}

function line(label: string, before: number | string, after: number | string) {
  const ok = String(before) === String(after);
  const mark = ok ? "  ok  " : " DIFF ";
  console.log(`   ${mark} ${label.padEnd(14)} ${String(before).padEnd(24)} -> ${after}`);
  return ok;
}

async function roundTrip(file: string, mode?: "preserve" | "accept" | "reject" | "strip") {
  const buf = await readFile(path.join(FIXTURES, file));
  const before = await shapeOf(buf);

  const doc = await Document.loadFromBuffer(buf, mode ? { revisionHandling: mode } : undefined);
  const out = await doc.toBuffer();
  const after = await shapeOf(out);

  console.log(`\n${file}  [revisionHandling: ${mode ?? "(default, unspecified)"}]`);
  const checks = [
    line("w:ins", before.ins, after.ins),
    line("w:del", before.del, after.del),
    line("w:delText", before.delText, after.delText),
    line("tables", before.tables, after.tables),
    line("table rows", before.rows, after.rows),
    line("bold runs", before.bold, after.bold),
    line("italic runs", before.italic, after.italic),
    line("authors", before.authors.join("|") || "(none)", after.authors.join("|") || "(none)"),
  ];
  const textSame = before.text === after.text;
  console.log(`   ${textSame ? "  ok  " : " DIFF "} ${"visible text".padEnd(14)} ${before.text.length} chars -> ${after.text.length} chars`);
  if (!textSame) {
    console.log(`          before: ${before.text.slice(0, 110)}`);
    console.log(`          after : ${after.text.slice(0, 110)}`);
  }
  console.log(`          xml size ${before.xmlLength} -> ${after.xmlLength}`);
  return checks.every(Boolean) && textSame;
}

async function main() {
  console.log("=".repeat(72));
  console.log("docXMLater 12.1.0 — §1.3.1 evaluation");
  console.log("=".repeat(72));

  // The question the README's "accept by default" claim raises.
  console.log("\n### 1. What does the DEFAULT do to a counterparty redline?");
  await roundTrip("03-tracked-one-author.docx");

  console.log("\n### 2. Explicit preserve — the mode we would actually use");
  await roundTrip("03-tracked-one-author.docx", "preserve");
  await roundTrip("04-tracked-two-authors.docx", "preserve");

  console.log("\n### 3. Structure survival (no revisions involved)");
  await roundTrip("01-clean-simple.docx", "preserve");
  await roundTrip("02-heavy-tables.docx", "preserve");
}

main().catch((e) => { console.error("\nFAILED:", e); process.exit(1); });
