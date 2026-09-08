import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, para, run, table } from "../helpers/docx-package";

/**
 * Replacing a table (the user's decision of 2026-09-07).
 *
 * The oracle is the real test here. Striking a table and inserting a copy means
 * the file briefly holds two where the contract held one, and the only thing
 * that makes that safe is that rejecting our changes puts it back exactly.
 */

const AUTHOR = "Jane Associate";

function finding(over: Partial<RevisionFinding> = {}): RevisionFinding {
  return {
    id: "finding-1",
    clause_type: "cancellation",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Damages too high.",
    cd_standard: "CD position.",
    location_section: null,
    ...over,
  };
}

async function redline(originalBytes: Uint8Array, findings: RevisionFinding[]) {
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const xml = await (await JSZip.loadAsync(result.docxBytes)).file("word/document.xml")!.async("string");
  return { result, report, xml };
}

const SCHEDULE = [
  ["Days Prior to Arrival", "Damages"],
  ["365 or more", "25%"],
  ["180 to 91", "50%"],
];

describe("a change spanning cells", () => {
  it("strikes the table and inserts an edited copy", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.unapplied).toEqual([]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
    // Two tables in the file, one struck and one added.
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    expect(xml).toContain("25%");
  });

  it("marks the rows themselves, not just the text", async () => {
    // Without the row markers Word renders the table wrongly — the same class
    // of omission as the paragraph-mark bug Stage 0 found.
    const { xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);

    expect(xml).toMatch(/<w:trPr><w:del /);
    expect(xml).toMatch(/<w:trPr><w:ins /);
  });

  it("keeps the tables apart so Word does not merge them", async () => {
    const { xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);
    // A paragraph between the two, or Word renders them as one table.
    expect(xml).toMatch(/<\/w:tbl><w:p>[\s\S]*?<\/w:p><w:tbl>/);
  });

  it("carries the original's formatting into the copy rather than rebuilding it", async () => {
    const shaded =
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="8"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1500"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr>${para(run("180 to 91"))}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>${para(run("50%"))}</w:tc></w:tr></w:tbl>`;
    const { xml } = await redline(await buildDocx(shaded), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);

    // Borders, shading and column widths appear twice — once per table.
    expect((xml.match(/w:fill="D9D9D9"/g) ?? []).length).toBe(2);
    expect((xml.match(/<w:gridCol w:w="3000"\/>/g) ?? []).length).toBe(2);
    expect((xml.match(/<w:tblBorders>/g) ?? []).length).toBe(2);
  });

  it("refuses when the proposed wording does not lay back out across the cells", async () => {
    // Wording in the wrong column is worse than a finding the associate has to
    // raise by hand, so a mismatch is refused rather than guessed at.
    const { result } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "Damages are reduced to twenty-five percent." }),
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.unapplied[0].reason).toBe("crosses_boundary");
  });
});

describe("a change inside one cell", () => {
  it("is edited in place, leaving the table alone", async () => {
    // The common case. Replacing the whole table here would show the property
    // an entire cancellation schedule struck through in red to change a number.
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "50%", language: "25%" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(1);
  });
});

describe("real fixtures with tables", () => {
  it("handles a nested, merged-cell table without the oracle objecting", async () => {
    const bytes = new Uint8Array(await readFile(path.join("tests", "fixtures", "13-nested-merged-tables.docx")));
    const { report } = await redline(bytes, [
      finding({ quoted_text: "Tier A fifty percent (50%)", language: "Tier A twenty-five percent (25%)" }),
    ]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
  });

  it("handles a table that already carries the counterparty's changes", async () => {
    const bytes = new Uint8Array(await readFile(path.join("tests", "fixtures", "09-tracked-in-tables.docx")));
    const { report } = await redline(bytes, [
      finding({ quoted_text: "seventy-five percent (75%)", language: "sixty percent (60%)" }),
    ]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
  });
});
