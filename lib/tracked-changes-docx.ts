import JSZip from "jszip";
import type { MemoFinding } from "./export-memo";

/**
 * Injects real Word tracked-changes (`<w:ins>`/`<w:del>`) into the ORIGINAL
 * uploaded DOCX for each accepted/edited finding — not a generic XML-tree
 * parse/rebuild of word/document.xml (round-tripping the whole tree through
 * a generic parser risks producing a file Word can't open, or that silently
 * loses formatting), but targeted, surgical string splicing: everything in
 * the file except the specific runs touched stays byte-for-byte untouched.
 *
 * DOCX-sourced analyses only — see docs/redline-export-plan.md for why this
 * can't extend to PDF- or DOC-sourced ones. Rationale text isn't embedded
 * here (that would need Word's separate comments.xml mechanism) — it's
 * already visible in the app and in the other export formats.
 */

interface RunInfo {
  runStart: number; // index into document.xml of the run's opening <w:r...>
  runEnd: number; // index right after this run's </w:r>
  rPrXml: string; // "<w:rPr>...</w:rPr>" if present, else ""
  text: string; // decoded plain text content of this run's <w:t>
  plainStart: number; // offset of this run's text within the reconstructed plain text
  plainEnd: number;
}

interface EditOp {
  start: number;
  end: number;
  replacementXml: string;
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function encodeXmlEntities(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildRunIndex(documentXml: string): { plainText: string; runs: RunInfo[] } {
  const runs: RunInfo[] = [];
  let plainText = "";

  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let pMatch: RegExpExecArray | null;
  let firstParagraph = true;

  while ((pMatch = paragraphRegex.exec(documentXml))) {
    const paraXml = pMatch[0];
    const paraStartInDoc = pMatch.index;

    if (!firstParagraph) plainText += "\n\n";
    firstParagraph = false;

    const runRegex = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = runRegex.exec(paraXml))) {
      const runXml = rMatch[0];
      const runStart = paraStartInDoc + rMatch.index;
      const runEnd = runStart + runXml.length;

      const rPrMatch = runXml.match(/^<w:r\b[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)/);
      const rPrXml = rPrMatch ? rPrMatch[1] : "";

      const tMatch = runXml.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/);
      if (!tMatch) continue; // no text (e.g. a tab/break-only run) — nothing to index

      const text = decodeXmlEntities(tMatch[1]);
      if (!text) continue;

      const plainStart = plainText.length;
      plainText += text;
      const plainEnd = plainText.length;

      runs.push({ runStart, runEnd, rPrXml, text, plainStart, plainEnd });
    }
  }

  return { plainText, runs };
}

/** Matches a finding's quoted text tolerating whitespace differences, without disturbing character offsets (needed for precise splicing). */
function findQuoteMatch(plainText: string, quotedText: string): { start: number; end: number } | null {
  const words = quotedText.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const match = new RegExp(pattern, "i").exec(plainText);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

function buildDelInsXml({
  rPrXml,
  deletedPieces,
  insertedText,
  revisionId,
  author,
  date,
}: {
  rPrXml: string;
  deletedPieces: string[];
  insertedText: string;
  revisionId: () => number;
  author: string;
  date: string;
}): string {
  const delRuns = deletedPieces
    .map((piece) => `<w:r>${rPrXml}<w:delText xml:space="preserve">${encodeXmlEntities(piece)}</w:delText></w:r>`)
    .join("");
  const del = `<w:del w:id="${revisionId()}" w:author="${encodeXmlEntities(author)}" w:date="${date}">${delRuns}</w:del>`;
  const ins = `<w:ins w:id="${revisionId()}" w:author="${encodeXmlEntities(author)}" w:date="${date}"><w:r>${rPrXml}<w:t xml:space="preserve">${encodeXmlEntities(insertedText)}</w:t></w:r></w:ins>`;
  return del + ins;
}

function buildInsertedParagraph(text: string, revisionId: () => number, author: string, date: string): string {
  return `<w:p><w:ins w:id="${revisionId()}" w:author="${encodeXmlEntities(author)}" w:date="${date}"><w:r><w:t xml:space="preserve">${encodeXmlEntities(text)}</w:t></w:r></w:ins></w:p>`;
}

export interface TrackedChangesResult {
  docxBytes: Uint8Array;
  matchedCount: number;
  unmatchedCount: number;
}

export async function generateTrackedChangesDocx({
  originalDocxBytes,
  findings,
  author,
}: {
  originalDocxBytes: Uint8Array;
  findings: MemoFinding[];
  author: string;
}): Promise<TrackedChangesResult> {
  const zip = await JSZip.loadAsync(originalDocxBytes);
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    throw new Error("Not a valid DOCX file — word/document.xml is missing.");
  }
  const documentXml = await documentXmlFile.async("string");
  const { plainText, runs } = buildRunIndex(documentXml);

  const existingIds = [...documentXml.matchAll(/w:id="(\d+)"/g)].map((m) => parseInt(m[1], 10));
  let nextId = existingIds.length ? Math.max(...existingIds) + 1 : 9000;
  const revisionId = () => nextId++;
  const date = new Date().toISOString();

  const ops: EditOp[] = [];
  // Two different situations, kept separate rather than lumped into one bucket:
  // a clause that genuinely doesn't exist in the contract vs. one that does but
  // couldn't be pinpointed precisely enough for in-place markup.
  const missingClauses: MemoFinding[] = [];
  const notLocated: MemoFinding[] = [];

  for (const finding of findings) {
    if (finding.is_missing_clause || !finding.quoted_text) {
      missingClauses.push(finding);
      continue;
    }

    const match = findQuoteMatch(plainText, finding.quoted_text);
    const overlapping = match ? runs.filter((r) => r.plainStart < match.end && r.plainEnd > match.start) : [];

    if (!match || overlapping.length === 0) {
      notLocated.push(finding);
      continue;
    }

    const first = overlapping[0];
    const last = overlapping[overlapping.length - 1];
    const conflicts = ops.some((op) => op.start < last.runEnd && op.end > first.runStart);
    if (conflicts) {
      notLocated.push(finding);
      continue;
    }

    const beforeText = first.text.slice(0, Math.max(0, match.start - first.plainStart));
    const afterText = last.text.slice(Math.max(0, match.end - last.plainStart));

    const deletedPieces: string[] = [];
    overlapping.forEach((run, i) => {
      const localStart = i === 0 ? Math.max(0, match.start - run.plainStart) : 0;
      const localEnd = i === overlapping.length - 1 ? Math.max(0, match.end - run.plainStart) : run.text.length;
      const piece = run.text.slice(localStart, localEnd);
      if (piece) deletedPieces.push(piece);
    });

    const delInsXml = buildDelInsXml({
      rPrXml: first.rPrXml,
      deletedPieces,
      insertedText: finding.language,
      revisionId,
      author,
      date,
    });
    const beforeXml = beforeText
      ? `<w:r>${first.rPrXml}<w:t xml:space="preserve">${encodeXmlEntities(beforeText)}</w:t></w:r>`
      : "";
    const afterXml = afterText
      ? `<w:r>${last.rPrXml}<w:t xml:space="preserve">${encodeXmlEntities(afterText)}</w:t></w:r>`
      : "";

    ops.push({ start: first.runStart, end: last.runEnd, replacementXml: beforeXml + delInsXml + afterXml });
  }

  ops.sort((a, b) => b.start - a.start);
  let newDocumentXml = documentXml;
  for (const op of ops) {
    newDocumentXml = newDocumentXml.slice(0, op.start) + op.replacementXml + newDocumentXml.slice(op.end);
  }

  function buildAppendixSection(heading: string, items: MemoFinding[]): string {
    if (items.length === 0) return "";
    const headingXml = `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${encodeXmlEntities(heading)}</w:t></w:r></w:p>`;
    const itemsXml = items
      .map((f) => {
        const label = `${f.severity.toUpperCase()} — ${f.clause_type.replace(/_/g, " ").toUpperCase()}: `;
        return buildInsertedParagraph(label + f.language, revisionId, author, date);
      })
      .join("");
    return headingXml + itemsXml;
  }

  const appendixXml =
    buildAppendixSection("REQUESTED ADDITIONS (not present in the original)", missingClauses) +
    buildAppendixSection(
      "COULD NOT BE LOCATED FOR MARKUP (present in the contract — see the app for exact wording)",
      notLocated
    );

  if (appendixXml) {
    const sectPrIndex = newDocumentXml.lastIndexOf("<w:sectPr");
    const insertAt = sectPrIndex !== -1 ? sectPrIndex : newDocumentXml.lastIndexOf("</w:body>");
    newDocumentXml = newDocumentXml.slice(0, insertAt) + appendixXml + newDocumentXml.slice(insertAt);
  }

  zip.file("word/document.xml", newDocumentXml);
  const docxBytes = await zip.generateAsync({ type: "uint8array" });

  return { docxBytes, matchedCount: ops.length, unmatchedCount: missingClauses.length + notLocated.length };
}
