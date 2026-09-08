import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractDocx, isSynthetic, type MapEntry, type SourceRef } from "@/lib/docx";

const DIR = path.join("tests", "fixtures");
const load = async (f: string) => extractDocx(await readFile(path.join(DIR, f)));
const allFixtures = async () => (await readdir(DIR)).filter((f) => f.endsWith(".docx")).sort();

/** The map entry for the first character of `needle`, or null if absent/synthetic. */
function refAt(text: string, map: MapEntry[], needle: string): SourceRef | null {
  const i = text.indexOf(needle);
  if (i < 0) return null;
  const e = map[i];
  return isSynthetic(e) ? null : e;
}

describe("extraction — determinism (§1.4.8)", () => {
  // Everything downstream assumes this. The map is rebuilt at export time
  // rather than stored, so a second extraction that differs from the first
  // would place edits in the wrong place.
  it("produces byte-identical text and an identical map every time", async () => {
    const bytes = await readFile(path.join(DIR, "09-tracked-in-tables.docx"));
    const first = await extractDocx(bytes);
    const text = first.document.text;
    const map = JSON.stringify(first.document.map);

    for (let i = 0; i < 100; i++) {
      const again = await extractDocx(bytes);
      expect(again.document.text, `text differed on run ${i + 2}`).toBe(text);
      expect(JSON.stringify(again.document.map), `map differed on run ${i + 2}`).toBe(map);
    }
  });

  it("is stable across every fixture", async () => {
    for (const f of await allFixtures()) {
      const bytes = await readFile(path.join(DIR, f));
      const a = await extractDocx(bytes);
      const b = await extractDocx(bytes);
      expect(a.document.text, f).toBe(b.document.text);
      expect(JSON.stringify(a.document.map), f).toBe(JSON.stringify(b.document.map));
    }
  });
});

describe("extraction — map coverage (§1.4.9)", () => {
  it("gives every character of every part a map entry", async () => {
    for (const f of await allFixtures()) {
      const r = await load(f);
      for (const p of r.parts) {
        expect(p.map.length, `${f} / ${p.part}`).toBe(p.text.length);
      }
    }
  });

  it("maps every non-synthetic character to a real run", async () => {
    for (const f of await allFixtures()) {
      const r = await load(f);
      for (const p of r.parts) {
        p.map.forEach((e, i) => {
          if (isSynthetic(e)) return;
          expect(e.part, `${f} @${i}`).toBe(p.part);
          expect(e.runIndex, `${f} @${i}`).toBeGreaterThanOrEqual(0);
          expect(e.offsetWithinRun, `${f} @${i}`).toBeGreaterThanOrEqual(0);
        });
      }
    }
  });
});

describe("extraction — the three views (§1.4.3)", () => {
  it("shows the counterparty's insertion and hides their deletion", async () => {
    const { document } = await load("03-tracked-one-author.docx");
    // They replaced "cumulative" with "night-by-night".
    expect(document.text).toContain("night-by-night");
    expect(document.text).not.toContain("cumulative");
    expect(document.originalText).toContain("cumulative");
    expect(document.originalText).not.toContain("night-by-night");
  });

  it("treats a move as a move, not a delete plus an insert", async () => {
    // If moveFrom were read as ordinary text the clause would appear twice in
    // the current view, and be analysed where it no longer sits.
    const { document } = await load("05-move-from-to.docx");
    const clause = "indemnify Hotel against all claims";
    const count = (s: string) => s.split(clause).length - 1;

    expect(count(document.text), "current view").toBe(1);
    expect(count(document.originalText), "original view").toBe(1);
    // It moved: in the current view it sits under Indemnification, originally under Deposits.
    expect(document.text.indexOf("2. Indemnification")).toBeLessThan(document.text.indexOf(clause));
    expect(document.originalText.indexOf(clause)).toBeLessThan(document.originalText.indexOf("2. Indemnification"));
  });

  it("records who already edited the contract and how much", async () => {
    const r = await load("04-tracked-two-authors.docx");
    expect(r.existingRevisions.present).toBe(true);
    expect(r.existingRevisions.authors).toEqual(["Dana Reyes", "Morgan Ellis"]);
    expect(r.existingRevisions.count).toBeGreaterThan(0);

    const clean = await load("01-clean-simple.docx");
    expect(clean.existingRevisions.present).toBe(false);
    expect(clean.existingRevisions.authors).toEqual([]);
  });
});

describe("extraction — structure for the model (§1.4.5)", () => {
  it("keeps the cancellation schedule a table, with every row", async () => {
    // This is the failure that started §1.4: mammoth.extractRawText flattened
    // these to prose, and they carry the largest dollar exposure in the contract.
    const { document } = await load("02-heavy-tables.docx");
    expect(document.text).toContain("| Days Prior to Arrival  | Damages (% of Room Revenue)  |");
    expect(document.text).toContain("| --- | --- |");
    for (const row of ["365 or more", "364 to 181", "180 to 91", "90 to 31", "30 or fewer"]) {
      expect(document.text, row).toContain(row);
    }
    // Each row on its own line, so the grid survives.
    const rows = document.text.split("\n").filter((l) => l.startsWith("| ") && !l.includes("---"));
    expect(rows.length).toBeGreaterThanOrEqual(11);
  });

  it("emits real list numbering, so cross-references mean something", async () => {
    const { document } = await load("07-numbering-crossref.docx");
    expect(document.text).toContain("1.a Attrition is measured cumulatively");
    expect(document.text).toContain("1.a.i Liability applies only below");
    expect(document.text).toContain("1.b Cancellation damages");
    // The clause referring to "Section 1.a" is only meaningful with the numbers.
    expect(document.text).toContain("Section 1.a");
  });

  it("marks headings", async () => {
    const { document } = await load("01-clean-simple.docx");
    expect(document.text).toContain("# 1. Room Block");
  });

  it("reads headers and footers, which carry contract terms", async () => {
    const r = await load("06-header-footer-terms.docx");
    expect(r.parts.map((p) => p.part)).toEqual(["document", "header1", "footer1"]);
    const header = r.parts.find((p) => p.part === "header1")!;
    // Invisible to the pipeline before this.
    expect(header.text).toContain("thirty (30) days prior to arrival");
    const footer = r.parts.find((p) => p.part === "footer1")!;
    expect(footer.text).toContain("one hundred percent (100%)");
  });
});

describe("extraction — locating text Word split apart", () => {
  it("finds a phrase Word broke across runs mid-word", async () => {
    // "eighty percent (80%)" exists in no single run of this fixture; the
    // library evaluated in §1.3 could not find it at all.
    const { document } = await load("10-word-run-splitting.docx");
    expect(document.text).toContain("eighty percent (80%)");
    const ref = refAt(document.text, document.map, "eighty percent (80%)");
    expect(ref).not.toBeNull();
    expect(ref!.runIndex).toBeGreaterThanOrEqual(0);
  });

  it("maps a split phrase across more than one run", async () => {
    const { document } = await load("10-word-run-splitting.docx");
    const i = document.text.indexOf("eighty percent (80%)");
    const runs = new Set<number>();
    for (let k = i; k < i + "eighty percent (80%)".length; k++) {
      const e = document.map[k];
      if (!isSynthetic(e)) runs.add(e.runIndex);
    }
    expect(runs.size).toBeGreaterThan(1);
  });
});

describe("extraction — constructs that must not be edited (§1.4.7)", () => {
  it("reads content-control text but flags it as protected", async () => {
    const { document } = await load("08-content-controls-fields.docx");
    // The text is real contract language the model should see...
    expect(document.text).toContain("Acme Association");
    expect(document.text).toContain("eighty percent (80%)");
    // ...but §1.5.3 must refuse to redline it.
    expect(refAt(document.text, document.map, "Acme Association")?.insideContentControl).toBe(true);
    expect(refAt(document.text, document.map, "eighty percent (80%)")?.insideContentControl).toBe(true);
  });

  it("flags field results and hides the field instructions", async () => {
    const { document } = await load("07-numbering-crossref.docx");
    expect(document.text).toContain("Section 1.a");
    expect(refAt(document.text, document.map, "Section 1.a")?.insideField).toBe(true);
    // Field machinery is not contract language.
    expect(document.text).not.toContain("REF _Ref_attrition");
    expect(document.text).not.toContain("\\h");
  });

  it("flags text inside tables and inside existing insertions", async () => {
    const tables = await load("09-tracked-in-tables.docx");
    const inCell = refAt(tables.document.text, tables.document.map, "ninety percent (90%)");
    expect(inCell?.insideTable).toBe(true);
    // That cell's text is the counterparty's own insertion, which is where a
    // deletion of ours has to nest (§1.5.7).
    expect(inCell?.insideIns).toBe(true);
  });

  it("flags hyperlink text", async () => {
    const { document } = await load("15-links-footnotes-comments.docx");
    expect(refAt(document.text, document.map, "the hotel fee schedule")?.insideHyperlink).toBe(true);
  });
});

describe("extraction — intake health gate (§1.4.9)", () => {
  it("routes every valid fixture to the DOCX path", async () => {
    for (const f of await allFixtures()) {
      const r = await load(f);
      expect(r.health.route, `${f}: ${r.health.reason ?? ""}`).toBe("docx_native");
      expect(r.health.checks.every((c) => c.passed), f).toBe(true);
    }
  });

  it("routes a document with almost no text to the PDF path", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>");
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>`
    );
    const r = await extractDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(r.health.route).toBe("pdf");
    expect(r.health.reason).toBeTruthy();
  });

  it("explains a downgrade in language an associate can act on", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
    );
    const r = await extractDocx(await zip.generateAsync({ type: "uint8array" }));
    expect(r.health.route).toBe("pdf");
    // No XML jargon in something shown to an associate.
    expect(r.health.reason).not.toMatch(/xml|node|w:/i);
  });
});
