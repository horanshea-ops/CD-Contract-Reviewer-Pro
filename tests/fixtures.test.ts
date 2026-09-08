import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

/**
 * Locks what each fixture is *for*. These files are the input to every later
 * assertion about extraction and revision insertion, so a fixture that quietly
 * loses its tracked changes would turn a real engine bug into a green test.
 *
 * Regenerate with `npm run fixtures:generate` — output is byte-stable, so a
 * diff here means the generator changed, not the clock.
 */

const DIR = path.join("tests", "fixtures");

async function docXml(file: string) {
  const buf = await readFile(path.join(DIR, file));
  const zip = await JSZip.loadAsync(buf);
  const part = zip.file("word/document.xml");
  expect(part, `${file} has no word/document.xml`).not.toBeNull();
  return { xml: await part!.async("string"), entries: Object.keys(zip.files) };
}

const count = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const authorsOf = (xml: string) =>
  [...new Set([...xml.matchAll(/w:author="([^"]+)"/g)].map((m) => m[1]))].sort();

describe("DOCX fixtures", () => {
  it("contain no directory entries, which is what keeps them byte-stable", async () => {
    const all = (await readdir(DIR)).filter((f) => f.endsWith(".docx")).sort();
    expect(all).toHaveLength(10);
    for (const f of all) {
      const { entries } = await docXml(f);
      expect(entries.filter((e) => e.endsWith("/")), `${f} has folder entries`).toHaveLength(0);
      expect(entries.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("01 is clean — no revisions to confuse a baseline", async () => {
    const { xml } = await docXml("01-clean-simple.docx");
    expect(count(xml, /<w:ins\b/g)).toBe(0);
    expect(count(xml, /<w:del\b/g)).toBe(0);
    expect(xml).toContain("eighty percent (80%)");
  });

  it("02 carries real tables, which is where the largest dollar exposure lives", async () => {
    const { xml } = await docXml("02-heavy-tables.docx");
    expect(count(xml, /<w:tbl>/g)).toBe(2);
    expect(count(xml, /<w:tr\b/g)).toBe(11);
    expect(xml).toContain("Days Prior to Arrival");
  });

  it("03 has one counterparty's tracked changes, both kinds", async () => {
    const { xml } = await docXml("03-tracked-one-author.docx");
    expect(count(xml, /<w:ins\b/g)).toBe(2);
    expect(count(xml, /<w:del\b/g)).toBe(2);
    // delText, not w:t — the distinction the accepted vs original views turn on.
    expect(count(xml, /<w:delText\b/g)).toBe(2);
    expect(authorsOf(xml)).toEqual(["Dana Reyes"]);
  });

  it("04 has two authors and mixed run formatting", async () => {
    const { xml } = await docXml("04-tracked-two-authors.docx");
    expect(authorsOf(xml)).toEqual(["Dana Reyes", "Morgan Ellis"]);
    expect(count(xml, /<w:ins\b/g)).toBe(3);
    expect(count(xml, /<w:del\b/g)).toBe(2);
    // §1.5.4: a span crossing these boundaries must keep its rPr on every piece.
    expect(count(xml, /<w:b\/>/g)).toBe(2);
    expect(count(xml, /<w:i\/>/g)).toBe(1);
    expect(xml).toContain("$47,500.00");
  });

  it("05 uses Word's move tracking, not delete-plus-insert", async () => {
    const { xml } = await docXml("05-move-from-to.docx");
    expect(count(xml, /<w:moveFrom\b/g)).toBe(1);
    expect(count(xml, /<w:moveTo\b/g)).toBe(1);
    // Paired by name: an engine that ignores the pairing sees the clause twice.
    expect(xml).toContain('w:name="move_indemnity"');
  });

  it("06 keeps contract terms in the header and footer parts", async () => {
    const { entries } = await docXml("06-header-footer-terms.docx");
    expect(entries).toContain("word/header1.xml");
    expect(entries).toContain("word/footer1.xml");
  });

  it("07 has multi-level numbering and a cross-reference field", async () => {
    const { xml, entries } = await docXml("07-numbering-crossref.docx");
    expect(entries).toContain("word/numbering.xml");
    expect(count(xml, /<w:numPr>/g)).toBe(6);
    expect(count(xml, /<w:ilvl w:val="2"\/>/g)).toBe(2);
    // "Section 1.a" is a field result — §1.4.7 says never treat it as editable.
    expect(xml).toContain("<w:instrText");
    expect(xml).toContain("REF _Ref_attrition");
  });

  it("08 puts a negotiable term inside a content control", async () => {
    const { xml } = await docXml("08-content-controls-fields.docx");
    expect(count(xml, /<w:sdt>/g)).toBe(2);
    // The attrition percentage lives inside the control, so §1.5.3's refusal
    // has something real to fire on.
    expect(xml).toMatch(/<w:sdtContent><w:r><w:t[^>]*>eighty percent \(80%\)<\/w:t>/);
  });

  it("09 has tracked changes inside table cells, where the money is", async () => {
    const { xml } = await docXml("09-tracked-in-tables.docx");
    expect(count(xml, /<w:tbl>/g)).toBe(1);
    expect(count(xml, /<w:ins\b/g)).toBe(2);
    expect(count(xml, /<w:del\b/g)).toBe(2);
    // Both revisions sit inside <w:tc>, not in a body paragraph.
    const cells = xml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [];
    expect(cells.filter((c) => /<w:ins\b/.test(c))).toHaveLength(2);
  });

  it("10 splits a phrase across runs the way Word actually does", async () => {
    const { xml } = await docXml("10-word-run-splitting.docx");
    // The phrase is readable but exists in no single run — the case that
    // defeated docXMLater entirely (docs/library-evaluation.md).
    expect(xml).not.toContain("eighty percent (80%)");
    expect(xml).toContain("eighty per");
    expect(xml).toContain("cent</w:t>");
    expect(count(xml, /<w:proofErr/g)).toBe(2);
    expect(xml).toMatch(/w:rsidR="00A12B34"/);
    expect(count(xml, /<w:bookmarkStart/g)).toBe(1);
  });
});
