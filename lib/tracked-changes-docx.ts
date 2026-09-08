import JSZip from "jszip";
import type { MemoFinding } from "./export-memo";
import type { RedlineEngineResult, UnappliedFinding, UnappliedReason } from "./redline-validation/types";

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

/**
 * A paragraph that is itself an insertion needs the paragraph-mark marked too,
 * not just its runs: without the marker in pPr/rPr, rejecting all changes
 * removes the text but leaves an empty paragraph behind.
 */
function buildInsertedParagraph(
  text: string,
  revisionId: () => number,
  author: string,
  date: string,
  rPrXml = ""
): string {
  const a = encodeXmlEntities(author);
  const pPr = `<w:pPr><w:rPr><w:ins w:id="${revisionId()}" w:author="${a}" w:date="${date}"/></w:rPr></w:pPr>`;
  const body = `<w:ins w:id="${revisionId()}" w:author="${a}" w:date="${date}"><w:r>${rPrXml}<w:t xml:space="preserve">${encodeXmlEntities(text)}</w:t></w:r></w:ins>`;
  return `<w:p>${pPr}${body}</w:p>`;
}

export type TrackedChangesResult = RedlineEngineResult;

export async function generateTrackedChangesDocx({
  originalDocxBytes,
  findings,
  author,
}: {
  originalDocxBytes: Uint8Array;
  findings: MemoFinding[];
  author: string;
}): Promise<RedlineEngineResult> {
  const zip = await JSZip.loadAsync(originalDocxBytes);
  const documentXmlFile = zip.file("word/document.xml");
  if (!documentXmlFile) {
    throw new Error("Not a valid DOCX file — word/document.xml is missing.");
  }
  const documentXml = await documentXmlFile.async("string");
  const { plainText, runs } = buildRunIndex(documentXml);

  const existingIds = [...documentXml.matchAll(/w:id="(\d+)"/g)].map((m) => parseInt(m[1], 10));
  let nextId = existingIds.length ? Math.max(...existingIds) + 1 : 9000;
  // Recorded so §1.6's oracle attributes revisions by id rather than by author
  // name, which cannot tell ours from one that arrived with the document.
  const ownRevisionIds: string[] = [];
  const revisionId = () => {
    const id = nextId++;
    ownRevisionIds.push(String(id));
    return id;
  };
  const date = new Date().toISOString();

  const ops: EditOp[] = [];
  // Two different situations, kept separate rather than lumped into one bucket:
  // a clause that genuinely doesn't exist in the contract vs. one that does but
  // couldn't be pinpointed precisely enough for in-place markup. Each carries
  // the reason it was refused, which is what the associate sees before download
  // and what §1.6.5's weekly review groups by.
  const missingClauses: MemoFinding[] = [];
  const notLocated: MemoFinding[] = [];
  const unapplied: UnappliedFinding[] = [];

  const refuse = (finding: MemoFinding, reason: UnappliedReason) => {
    if (reason === "missing_clause") missingClauses.push(finding);
    else notLocated.push(finding);
    unapplied.push({
      clause_type: finding.clause_type,
      severity: finding.severity,
      quoted_text: finding.quoted_text,
      reason,
    });
  };

  for (const finding of findings) {
    if (finding.is_missing_clause || !finding.quoted_text) {
      refuse(finding, "missing_clause");
      continue;
    }

    const match = findQuoteMatch(plainText, finding.quoted_text);
    const overlapping = match ? runs.filter((r) => r.plainStart < match.end && r.plainEnd > match.start) : [];

    if (!match || overlapping.length === 0) {
      refuse(finding, "not_located");
      continue;
    }

    const first = overlapping[0];
    const last = overlapping[overlapping.length - 1];
    const conflicts = ops.some((op) => op.start < last.runEnd && op.end > first.runStart);
    if (conflicts) {
      refuse(finding, "overlaps_another_change");
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

    // Refuse any span that crosses a structural boundary. The splice below
    // replaces everything between the first and last run, so a span reaching
    // out of its container swallows that container's tags: crossing a cell
    // merges two cells and leaves the row short of the declared grid, and
    // crossing a <w:ins> or content control produces XML that does not parse
    // at all — a file Word refuses to open.
    //
    // Randomised testing put the corruption rate at 16% of realistic redlines
    // (scripts/fuzz-tracked-changes.ts), concentrated on documents that already
    // contain the counterparty's tracked changes — that is, every negotiation
    // round after the first.
    //
    // Refusing is the conservative half of the trade: the finding is reported
    // as unapplied and listed for the associate rather than silently mangling
    // the document. Handling these properly, especially nesting a deletion
    // inside the counterparty's insertion, is MASTER_PLAN.md §1.5.7.
    //
    // The character class after each name keeps <w:p> from matching <w:pPr>,
    // <w:tc> from <w:tcPr>, and <w:del> from <w:delText>.
    const spannedXml = documentXml.slice(first.runStart, last.runEnd);
    const CROSSES_BOUNDARY =
      /<\/?w:(?:p|tc|tr|tbl|ins|del|moveFrom|moveTo|sdt|sdtContent|hyperlink|fldChar)[ />]/;
    if (CROSSES_BOUNDARY.test(spannedXml)) {
      refuse(finding, "crosses_boundary");
      continue;
    }

    // Refuse a span holding content the splice cannot carry across. Only w:t
    // text is indexed and re-emitted, so a tab, a line break or a footnote
    // marker sitting between the first and last matched run is destroyed —
    // silently, and outside any revision mark, so rejecting every change no
    // longer returns the document the property sent.
    //
    // Found by the §1.6 oracle on the randomised corpus at roughly 2-5% of
    // generated documents (scripts/fuzz-tracked-changes.ts). Bookmarks and
    // proofErr markers are left out on purpose: losing one drops no content
    // and gating on them would refuse a great many legitimate edits.
    const SWALLOWS_CONTENT =
      /<w:(?:tab|br|cr|noBreakHyphen|softHyphen|sym|drawing|pict|object|footnoteReference|endnoteReference|commentReference)[ />]/;
    if (SWALLOWS_CONTENT.test(spannedXml)) {
      refuse(finding, "spans_non_text_content");
      continue;
    }

    ops.push({ start: first.runStart, end: last.runEnd, replacementXml: beforeXml + delInsXml + afterXml });
  }

  ops.sort((a, b) => b.start - a.start);
  let newDocumentXml = documentXml;
  for (const op of ops) {
    newDocumentXml = newDocumentXml.slice(0, op.start) + op.replacementXml + newDocumentXml.slice(op.end);
  }

  function buildAppendixSection(heading: string, items: MemoFinding[]): string {
    if (items.length === 0) return "";
    // The heading must be an insertion like the items under it. As plain text it
    // survived a reject-all, leaving internal tooling language ("COULD NOT BE
    // LOCATED FOR MARKUP...") permanently in a contract sent to a counterparty,
    // with no way for them to remove it by rejecting changes.
    const headingXml = buildInsertedParagraph(heading, revisionId, author, date, "<w:rPr><w:b/></w:rPr>");
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

  return { docxBytes, appliedCount: ops.length, unapplied, ownRevisionIds };
}
