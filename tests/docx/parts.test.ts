import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DocxParseError, loadDocx } from "@/lib/docx/parts";

const DIR = path.join("tests", "fixtures");
const load = async (f: string) => loadDocx(await readFile(path.join(DIR, f)));

describe("loadDocx", () => {
  it("reads the main document from every fixture", async () => {
    for (const f of ["01-clean-simple.docx", "09-tracked-in-tables.docx", "15-links-footnotes-comments.docx"]) {
      const pkg = await load(f);
      expect(pkg.document.name, f).toBe("document");
      expect(pkg.document.xml.length, f).toBeGreaterThan(100);
    }
  });

  it("finds headers and footers through the relationships, not by filename", async () => {
    const pkg = await load("06-header-footer-terms.docx");
    const names = pkg.headersFooters.map((p) => p.name).sort();
    expect(names).toEqual(["footer1", "header1"]);
    // The cutoff term lives only in the header — invisible to the old pipeline.
    const header = pkg.headersFooters.find((p) => p.name === "header1")!;
    expect(header.xml).toContain("Room block cutoff");
  });

  it("treats headers and footers as parts to walk, document first", async () => {
    const pkg = await load("06-header-footer-terms.docx");
    expect(pkg.textParts[0].name).toBe("document");
    expect(pkg.textParts).toHaveLength(3);
  });

  it("reads numbering when present and reports null when absent", async () => {
    expect((await load("07-numbering-crossref.docx")).numbering).not.toBeNull();
    expect((await load("01-clean-simple.docx")).numbering).toBeNull();
  });

  it("rejects a file that is not a zip", async () => {
    await expect(loadDocx(Buffer.from("this is not a docx"))).rejects.toBeInstanceOf(DocxParseError);
  });

  it("rejects a zip with no word/document.xml", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("hello.txt", "not a word document");
    await expect(loadDocx(await zip.generateAsync({ type: "uint8array" }))).rejects.toThrow(/document\.xml is missing/);
  });

  it("rejects malformed XML rather than parsing it into nonsense", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("word/document.xml", "<w:document><w:body><w:p></w:body></w:document>");
    await expect(loadDocx(await zip.generateAsync({ type: "uint8array" }))).rejects.toBeInstanceOf(DocxParseError);
  });
});
