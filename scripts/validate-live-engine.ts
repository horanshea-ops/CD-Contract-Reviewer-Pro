import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { generateTrackedChangesDocx } from "../lib/tracked-changes-docx";
import type { MemoFinding } from "../lib/export-memo";

/**
 * Stage 0 — validate the tracked-changes engine that is LIVE in the app today
 * (app/api/analyses/[id]/export-redline-docx/route.ts) against the full fixture
 * corpus, including the deliberately nasty ones.
 *
 * Writes nothing, changes no shipping code. The question is narrow and serious:
 * could an associate export a file today that is corrupt, silently redlines the
 * wrong clause, or loses content?
 *
 * Two things this harness gets right that an earlier draft did not, both of
 * which produced false alarms:
 *   - Well-formedness is checked by parsing the XML, not by counting tags with
 *     a regex, which cannot tell a self-closing paragraph from a pStyle element.
 *   - The reject oracle is scoped to OUR author. Rejecting every revision also
 *     unwinds the counterparty's, taking the document back past what they sent.
 */

const FIXTURES = path.join("tests", "fixtures");
const AUTHOR = "Jane Associate";

function finding(over: Partial<MemoFinding> = {}): MemoFinding {
  return {
    clause_type: "attrition",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    ...over,
  };
}

async function docXml(bytes: Uint8Array | Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const f = zip.file("word/document.xml");
  if (!f) throw new Error("word/document.xml missing");
  return { xml: await f.async("string"), entries: Object.keys(zip.files) };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** How the contract reads now: plain runs and insertions; deletions excluded. */
function acceptedText(xml: string) {
  const noDel = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return collapse([...noDel.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
}

/** How it reads after rejecting ONLY our author's revisions — the §1.6.2 oracle. */
function rejectedText(xml: string, author: string) {
  const a = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ourIns = new RegExp('<w:ins\\b[^>]*w:author="' + a + '"[^>]*>[\\s\\S]*?<\\/w:ins>', "g");
  const ourDel = new RegExp('<w:del\\b[^>]*w:author="' + a + '"[^>]*>([\\s\\S]*?)<\\/w:del>', "g");
  const withoutOurIns = xml.replace(ourIns, "");
  const restored = withoutOurIns.replace(ourDel, (_m, inner: string) =>
    inner.replace(/<w:delText/g, "<w:t").replace(/<\/w:delText>/g, "</w:t>")
  );
  return acceptedText(restored);
}

type Severity = "fatal" | "serious" | "minor";
interface Check { name: string; pass: boolean; detail?: string; severity: Severity }
const results: { fixture: string; checks: Check[] }[] = [];

function parseXml(xml: string) {
  const errors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, msg: unknown) => {
      if (level !== "warning") errors.push(String(msg).slice(0, 100));
    },
  });
  const doc = parser.parseFromString(xml, "text/xml");
  return { doc, errors };
}

async function validate(
  file: string,
  findings: MemoFinding[],
  extra?: (ctx: { beforeXml: string; afterXml: string }) => Check[]
) {
  const before = await readFile(path.join(FIXTURES, file));
  const { xml: beforeXml, entries: beforeEntries } = await docXml(before);
  const checks: Check[] = [];

  let out;
  try {
    out = await generateTrackedChangesDocx({ originalDocxBytes: before, findings, author: AUTHOR });
  } catch (e) {
    results.push({ fixture: file, checks: [{ name: "engine threw", pass: false, severity: "fatal", detail: (e as Error).message.slice(0, 110) }] });
    return;
  }

  let afterXml: string, afterEntries: string[];
  try {
    const r = await docXml(out.docxBytes);
    afterXml = r.xml; afterEntries = r.entries;
  } catch (e) {
    results.push({ fixture: file, checks: [{ name: "output is a readable DOCX", pass: false, severity: "fatal", detail: (e as Error).message }] });
    return;
  }

  const { doc: afterDoc, errors } = parseXml(afterXml);
  checks.push({ name: "output XML parses", pass: errors.length === 0, severity: "fatal", detail: errors[0] ?? "" });

  const { doc: beforeDoc } = parseXml(beforeXml);
  for (const tag of ["w:tbl", "w:tr", "w:tc", "w:p"]) {
    const b = beforeDoc.getElementsByTagName(tag).length;
    if (!b) continue;
    const a = afterDoc.getElementsByTagName(tag).length;
    // Paragraphs may legitimately increase (the appendix), never decrease.
    const pass = tag === "w:p" ? a >= b : a === b;
    checks.push({ name: `${tag} count`, pass, severity: "fatal", detail: pass ? "" : `${b} -> ${a}` });
  }

  const revIds = [...afterXml.matchAll(/<w:(?:ins|del)\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  const dupes = [...new Set(revIds.filter((v, i) => revIds.indexOf(v) !== i))];
  checks.push({ name: "revision ids unique", pass: dupes.length === 0, severity: "fatal", detail: dupes.join(",") });

  const tooBig = revIds.filter((v) => Number(v) > 2147483647);
  checks.push({ name: "revision ids within int32", pass: tooBig.length === 0, severity: "fatal", detail: tooBig.join(",") });

  const badDel = /<w:del\b[^>]*>(?:(?!<\/w:del>)[\s\S])*?<w:t[ >]/.test(afterXml);
  checks.push({ name: "w:del holds only delText", pass: !badDel, severity: "fatal" });

  const lost = beforeEntries.filter((e) => !afterEntries.includes(e));
  checks.push({ name: "no parts dropped", pass: lost.length === 0, severity: "fatal", detail: lost.join(", ") });

  const got = rejectedText(afterXml, AUTHOR);
  const want = acceptedText(beforeXml);
  checks.push({
    name: "reject-ours returns the input", pass: got === want, severity: "fatal",
    detail: got === want ? "" : `\n             got  "${got.slice(0, 95)}"\n             want "${want.slice(0, 95)}"`,
  });

  for (const [label, re] of [["bold", /<w:b[ \/>]/g], ["italic", /<w:i[ \/>]/g]] as const) {
    const b = (beforeXml.match(re) ?? []).length;
    if (!b) continue;
    const a = (afterXml.match(re) ?? []).length;
    checks.push({ name: `${label} preserved`, pass: a >= b, severity: "serious", detail: a >= b ? "" : `${b} -> ${a}` });
  }

  checks.push({ name: `applied ${out.appliedCount}, unapplied ${out.unapplied.length}`, pass: true, severity: "minor" });
  if (extra) checks.push(...extra({ beforeXml, afterXml }));
  results.push({ fixture: file, checks });
}

async function main() {
  console.log("=".repeat(78));
  console.log("Stage 0 — the LIVE engine (lib/tracked-changes-docx.ts), 15 fixtures");
  console.log("=".repeat(78));

  await validate("01-clean-simple.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]);
  await validate("02-heavy-tables.docx", [finding({ quoted_text: "50%", language: "40%", clause_type: "cancellation" })]);
  await validate("03-tracked-one-author.docx", [finding({ quoted_text: "night-by-night", language: "cumulative" })]);
  await validate("04-tracked-two-authors.docx", [finding({ quoted_text: "one hundred percent (100%)", language: "seventy percent (70%)" })]);
  await validate("05-move-from-to.docx", [finding({ quoted_text: "indemnify Hotel against all claims", language: "indemnify Hotel against third-party claims" })]);
  await validate("06-header-footer-terms.docx", [finding({ quoted_text: "thirty (30) days", language: "sixty (60) days", clause_type: "cutoff_date" })]);
  await validate("07-numbering-crossref.docx", [finding({ quoted_text: "seventy percent (70%)", language: "eighty percent (80%)" })]);
  await validate("08-content-controls-fields.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]);
  await validate("09-tracked-in-tables.docx", [finding({ quoted_text: "seventy-five percent (75%)", language: "sixty percent (60%)" })]);
  await validate("10-word-run-splitting.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]);

  await validate("11-repeated-phrases.docx",
    [finding({ clause_type: "cancellation", quoted_text: "Cancellation damages are eighty percent (80%) of anticipated room revenue.", language: "Cancellation damages are fifty percent (50%) of anticipated room revenue." })],
    ({ afterXml }) => {
      const struck = [...afterXml.matchAll(/<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/g)].map((m) => m[1]).join(" ");
      const right = /Cancellation damages/.test(struck);
      return [{ name: "edited the CORRECT occurrence", pass: right, severity: "fatal", detail: right ? "" : `struck: "${struck.slice(0, 75)}"` }];
    });

  await validate("12-tabs-breaks-symbols.docx", [
    finding({ clause_type: "deposit", quoted_text: "Balance", language: "Final balance" }),
    finding({ clause_type: "attrition", quoted_text: "90 % of the block", language: "70% of the block" }),
  ]);

  await validate("13-nested-merged-tables.docx",
    [finding({ clause_type: "cancellation", quoted_text: "Tier A fifty percent (50%)", language: "Tier A twenty-five percent (25%)" })]);

  await validate("14-revision-id-collisions.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]);

  await validate("15-links-footnotes-comments.docx",
    [finding({ clause_type: "mandatory_fees", quoted_text: "thirty-five dollars ($35.00) per room per night", language: "no resort fee" }),
     finding({ clause_type: "attrition", quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })],
    ({ beforeXml, afterXml }) => {
      const out: Check[] = [];
      for (const [label, re] of [["hyperlink", /<w:hyperlink/g], ["footnoteRef", /<w:footnoteReference/g], ["commentRangeStart", /<w:commentRangeStart/g], ["commentReference", /<w:commentReference/g], ["bookmarkStart", /<w:bookmarkStart/g]] as const) {
        const b = (beforeXml.match(re) ?? []).length, a = (afterXml.match(re) ?? []).length;
        out.push({ name: `${label} preserved`, pass: a === b, severity: "serious", detail: a === b ? "" : `${b} -> ${a}` });
      }
      return out;
    });

  let fatal = 0, serious = 0;
  for (const r of results) {
    const bad = r.checks.filter((c) => !c.pass);
    const info = r.checks.find((c) => c.severity === "minor");
    console.log(`\n${r.fixture}${info ? `   [${info.name}]` : ""}`);
    if (!bad.length) { console.log("    all checks passed"); continue; }
    for (const c of bad) {
      console.log(`    ${c.severity === "fatal" ? "FATAL  " : c.severity === "serious" ? "SERIOUS" : "minor  "} ${c.name}${c.detail ? "  — " + c.detail : ""}`);
      if (c.severity === "fatal") fatal++; else if (c.severity === "serious") serious++;
    }
  }
  console.log("\n" + "=".repeat(78));
  console.log(`${fatal} fatal, ${serious} serious across ${results.length} fixtures`);
}
main().catch((e) => { console.error("HARNESS THREW:", e); process.exit(1); });
