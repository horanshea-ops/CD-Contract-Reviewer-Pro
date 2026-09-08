import { readFile } from "node:fs/promises";
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
    for (const f of ["01-clean-simple.docx", "02-heavy-tables.docx", "03-tracked-one-author.docx", "04-tracked-two-authors.docx"]) {
      const { entries } = await docXml(f);
      expect(entries.filter((e) => e.endsWith("/")), `${f} has folder entries`).toHaveLength(0);
      expect(entries).toHaveLength(5);
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
});
