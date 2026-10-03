import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { extractDocx, parseXml, type ExtractedPart } from "../lib/docx";
import { tableGrids } from "../lib/docx/table-grid";
import { buildPreview } from "../lib/docx-preview";
import { acceptOwnRevisions } from "../lib/docx-accept";
import { checkCleanCopy } from "../lib/exports/clean-docx";
import { findingCategory } from "../lib/findings-overview";
import { assertsNoChange } from "../lib/proposed-language";
import { generateRedline, type RevisionFinding } from "../lib/redline-engine";
import { UNAPPLIED_REASON_TEXT, validateRedline } from "../lib/redline-validation";
import { diffProjections, projectMapped, revisionMarks } from "../lib/round-diff";
import { checkRenderedPdf, renderStructuredPdf } from "../lib/structured-pdf";
import { createAdminClient } from "../lib/supabase/admin";

/**
 * Runs a Word file that someone else has already marked up through everything
 * short of the model: what the file holds, what extraction reads, and a redline,
 * clean copy and both PDFs built on top of it. It makes no model call.
 *
 *   npx tsx scripts/word-roundtrip-check.ts <file.docx>
 *     --against <original.docx>   the file before the property touched it
 *     --findings <analysis id>    stand-in changes from an earlier review (id or its first characters)
 *     --author <name>             who our changes are signed as (default "Jerry Horan")
 *     --out <dir>                 where the built files go
 *
 * The contract stays outside git. Keep it in data/private/, and point --out at
 * a folder outside the repo.
 */

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const AUTHOR = flag("author") ?? "Jerry Horan";
const STAND_IN_NOTE = "Keeps the group's cost predictable if plans change.";

const REVISION_TAGS = [
  "w:ins",
  "w:del",
  "w:moveFrom",
  "w:moveTo",
  "w:rPrChange",
  "w:pPrChange",
  "w:tblPrChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:cellIns",
  "w:cellDel",
  "w:cellMerge",
];
const COMMENT_PARTS = ["comments.xml", "commentsExtended.xml", "commentsIds.xml", "commentsExtensible.xml", "people.xml"];

const heading = (title: string) => console.log(`\n=== ${title} ===`);
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);
const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");

const elementsOf = (doc: Document, tag: string): Element[] => {
  const nodes = doc.getElementsByTagName(tag);
  const out: Element[] = [];
  for (let i = 0; i < nodes.length; i++) out.push(nodes[i]);
  return out;
};

const textOf = (el: Element): string =>
  ["w:t", "w:delText"].flatMap((tag) => elementsOf(el as unknown as Document, tag).map((t) => t.textContent ?? "")).join("");

/** What the package holds: its parts, its revision markup and its comments. */
async function inventory(bytes: Uint8Array) {
  heading("What the file holds");
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files).filter((e) => !zip.files[e].dir).sort();
  console.log(`${entries.length} parts`);

  for (const name of COMMENT_PARTS) {
    console.log(`  word/${name.padEnd(24)} ${entries.includes(`word/${name}`) ? "present" : "absent"}`);
  }

  const ids = new Map<string, string[]>();
  for (const entry of entries.filter((e) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(e))) {
    const doc = parseXml(await zip.file(entry)!.async("string"), entry);
    const counts = REVISION_TAGS.map((tag) => [tag, elementsOf(doc, tag)] as const).filter(([, els]) => els.length);
    const comments = elementsOf(doc, "w:commentRangeStart");
    if (!counts.length && !comments.length) continue;

    console.log(`\n${entry}`);
    for (const [tag, els] of counts) {
      const authors = [...new Set(els.map((e) => e.getAttribute("w:author") ?? "(none)"))].join(", ");
      console.log(`  ${tag.padEnd(16)} ${String(els.length).padStart(3)}  by ${authors}`);
      for (const el of els) {
        const id = el.getAttribute("w:id") ?? "";
        ids.set(id, [...(ids.get(id) ?? []), tag]);
      }
    }
    for (const start of comments) {
      const id = start.getAttribute("w:id") ?? "";
      ids.set(id, [...(ids.get(id) ?? []), "comment"]);
    }
    if (comments.length) console.log(`  comment anchors  ${String(comments.length).padStart(3)}`);
  }

  const shared = [...ids].filter(([, uses]) => uses.length > 1);
  console.log(
    shared.length
      ? `\nIds used more than once: ${shared.map(([id, uses]) => `${id} (${uses.join(" + ")})`).join(", ")}`
      : "\nEvery revision and comment id is used once."
  );

  const commentsFile = zip.file("word/comments.xml");
  if (commentsFile) {
    const doc = parseXml(await commentsFile.async("string"), "word/comments.xml");
    console.log("\nComments");
    for (const c of elementsOf(doc, "w:comment")) {
      const paragraphs = elementsOf(c as unknown as Document, "w:p").length;
      console.log(
        `  #${c.getAttribute("w:id")} ${c.getAttribute("w:author")}: "${clip(textOf(c))}" (${paragraphs} paragraph${paragraphs === 1 ? "" : "s"})`
      );
    }
  }
}

/** What extraction reads, and whether its two views agree with its markup. */
async function extraction(bytes: Uint8Array) {
  heading("What extraction reads");
  const extracted = await extractDocx(bytes);
  console.log(`Route: ${extracted.health.route}${extracted.health.reason ? ` (${extracted.health.reason})` : ""}`);
  for (const c of extracted.health.checks) console.log(`  ${mark(c.passed)}  ${c.name.padEnd(20)} ${c.detail}`);

  const rev = extracted.existingRevisions;
  console.log(`\nExisting tracked changes: ${rev.count} by ${rev.authors.join(", ") || "nobody"}`);

  console.log(`\nComments read: ${extracted.comments.length} of ${extracted.commentsTotal}`);
  for (const c of extracted.comments) {
    const thread = `${c.replyTo ? ` (reply to #${c.replyTo})` : ""}${c.resolved ? " (resolved)" : ""}`;
    console.log(`  #${c.id} ${c.author}${thread}: "${clip(c.text, 70)}"  on  "${clip(c.quoted, 70)}"`);
  }

  for (const part of extracted.parts) {
    try {
      const marks = revisionMarks(part);
      if (!marks.length) continue;
      console.log(`\n${part.part}: ${marks.length} revision marks, views consistent`);
      for (const m of marks) {
        const kind = m.start === m.end ? "struck " : "added  ";
        const before = part.text.slice(Math.max(0, m.start - 45), m.start).replace(/\s+/g, " ");
        const after = part.text.slice(m.end, m.end + 30).replace(/\s+/g, " ");
        console.log(`  ${kind} "${clip(m.text, 50)}" by ${m.revision.author}   …${before}[${m.start === m.end ? "" : m.text}]${after}…`);
      }
    } catch (err) {
      console.log(`\n${part.part}: FAIL  ${err instanceof Error ? err.message : err}`);
    }
  }
  return extracted;
}

const bodyOf = (parts: ExtractedPart[]) => parts.find((p) => p.part === "document")!;

/** How the text the model will read differs from the file before the property's edits. */
async function against(originalPath: string, returned: ExtractedPart[]) {
  heading("Against the file before the edits");
  const original = await extractDocx(new Uint8Array(await readFile(originalPath)));

  console.log(`Parts before: ${original.parts.map((p) => p.part).join(", ")}`);
  console.log(`Parts now:    ${returned.map((p) => p.part).join(", ")}`);

  const a = bodyOf(original.parts);
  const b = bodyOf(returned);
  const diff = diffProjections(projectMapped(a.text, a.map).text, projectMapped(b.text, b.map).text);

  console.log(`\nBody wording kept: ${(diff.retained * 100).toFixed(1)}%. ${diff.regions.length} differing stretch(es).`);
  for (const r of diff.regions.slice(0, 60)) {
    console.log(`  ${r.kind.padEnd(8)} "${clip(r.baselineText, 70)}" -> "${clip(r.returnedText, 70)}"`);
  }
  if (diff.regions.length > 60) console.log(`  … and ${diff.regions.length - 60} more`);

  for (const [label, doc] of [["before", original], ["now", { parts: returned }]] as const) {
    const extra = doc.parts.filter((p) => p.part !== "document" && p.text.trim());
    for (const p of extra) console.log(`  ${label} ${p.part}: "${clip(p.text.replace(/\s+/g, " ").trim(), 100)}"`);
  }
}

/** Business findings of an earlier review that propose wording, as stand-in changes. */
async function standInFindings(idPrefix: string): Promise<{ findings: RevisionFinding[]; notes: Map<string, string> }> {
  const admin = createAdminClient();
  const { data: analyses, error } = await admin
    .from("analyses")
    .select("id, filename, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const analysis = (analyses ?? []).find((a) => a.id.startsWith(idPrefix));
  if (!analysis) throw new Error(`No analysis id starts with "${idPrefix}".`);
  console.log(`Stand-in changes from ${analysis.id} (${analysis.filename}, ${analysis.created_at.slice(0, 10)})`);

  const { data: rows, error: rowsError } = await admin
    .from("findings")
    .select(
      "id, clause_type, severity, category, is_missing_clause, quoted_text, location_section, finding_text, cd_standard, proposed_language, redline_note"
    )
    .eq("analysis_id", analysis.id);
  if (rowsError) throw rowsError;

  const usable = (rows ?? []).filter(
    (f) => findingCategory(f) === "business" && f.proposed_language?.trim() && !assertsNoChange(f.proposed_language)
  );
  console.log(`${rows?.length ?? 0} findings, ${usable.length} usable as changes`);

  return {
    findings: usable.map((f) => ({
      id: f.id,
      location_section: f.location_section,
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
    })),
    notes: new Map(usable.map((f) => [f.id, f.redline_note?.trim() || STAND_IN_NOTE])),
  };
}

/** A redline, clean copy and both PDFs on top of the file, each put through its own check. */
async function standInRedline(bytes: Uint8Array, idPrefix: string, outDir: string, stem: string) {
  heading("Our changes on top of theirs");
  const { findings, notes } = await standInFindings(idPrefix);

  const engineResult = await generateRedline({ originalDocxBytes: bytes, findings, comments: notes, author: AUTHOR });
  const report = await validateRedline({ originalBytes: bytes, engineResult, author: AUTHOR });

  console.log(`\nOutcome: ${report.outcome}. ${report.appliedCount} applied, ${report.unapplied.length} left out, ${report.widened.length} widened.`);
  console.log(`Our revisions: ${engineResult.ownRevisionIds.length}. Our comments: ${engineResult.ownCommentIds.length}.`);
  for (const c of report.checks) console.log(`  ${mark(c.passed)}  ${c.name.padEnd(24)} ${c.detail}`);

  if (report.unapplied.length) {
    console.log("\nLeft out");
    for (const u of report.unapplied) {
      console.log(`  ${u.clause_type.padEnd(28)} ${UNAPPLIED_REASON_TEXT[u.reason]}`);
      if (u.quoted_text) console.log(`      quote: "${clip(u.quoted_text.replace(/\s+/g, " "), 110)}"`);
    }
  }

  await mkdir(outDir, { recursive: true });
  const save = async (name: string, data: Uint8Array) => {
    const to = path.join(outDir, `${stem}-${name}`);
    await writeFile(to, data);
    console.log(`  wrote ${to}`);
  };

  console.log("\nFiles");
  await save("redline.docx", engineResult.docxBytes);
  if (report.outcome === "fallback") {
    console.log("  The redline failed validation, so no clean copy or PDF is built from it.");
    return;
  }

  const own = new Set(engineResult.ownRevisionIds);
  const ownComments = { ids: new Set(engineResult.ownCommentIds), createdPart: engineResult.createdCommentsPart };
  const clean = await acceptOwnRevisions(engineResult.docxBytes, own, ownComments);
  await save("proposed.docx", clean);
  const cleanProblems = await checkCleanCopy(engineResult.docxBytes, clean, own, ownComments);
  console.log(`  ${mark(cleanProblems.length === 0)}  clean copy ${cleanProblems.join(" ") || "reads as the redline with our changes accepted, and holds none of our comments"}`);

  const afterClean = await extractDocx(clean);
  console.log(
    `  The clean copy still shows ${afterClean.existingRevisions.count} tracked change(s) by ${afterClean.existingRevisions.authors.join(", ") || "nobody"}.`
  );

  const parts = buildPreview(await extractDocx(engineResult.docxBytes));
  const body = parts.find((p) => p.part === "document") ?? parts[0];
  for (const mode of ["markup", "clean"] as const) {
    const pdf = await renderStructuredPdf({
      blocks: body?.blocks ?? [],
      mode,
      ownRevisionIds: own,
      extraChanges: [],
      tableGrids: await tableGrids(engineResult.docxBytes),
    });
    const problems = await checkRenderedPdf(pdf);
    await save(`${mode}.pdf`, pdf.pdfBytes);
    console.log(`  ${mark(problems.length === 0)}  ${mode} PDF ${problems.join(" ") || "read back cleanly"}`);
  }
}

async function main() {
  if (!file) {
    throw new Error("Usage: npx tsx scripts/word-roundtrip-check.ts <file.docx> [--against <original.docx>] [--findings <analysis id>] [--author <name>] [--out <dir>]");
  }
  const bytes = new Uint8Array(await readFile(file));
  console.log(`${file} (${bytes.byteLength.toLocaleString()} bytes)`);

  await inventory(bytes);
  const extracted = await extraction(bytes);

  const originalPath = flag("against");
  if (originalPath) await against(originalPath, extracted.parts);

  const findingsFrom = flag("findings");
  if (findingsFrom) {
    const outDir = flag("out");
    if (!outDir) throw new Error("--findings needs --out <dir>, a folder outside the repo for the built files.");
    await standInRedline(bytes, findingsFrom, outDir, path.basename(file, ".docx"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
