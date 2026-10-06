import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { acceptOwnRevisions } from "@/lib/docx-accept";
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

  it("lays out a row written with a separator at each end", async () => {
    // The shape a real review wrote: the row as the extracted text shows it, edges included.
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "| 180 to 91 | 50% |", language: "| 180 to 91  | 25%  |" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(2);
    expect(xml).toContain("25%");
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
    // The quote runs across two cells and leaves out the "|" between them, and
    // so does the proposal. Each change sits inside one cell, so it goes in.
    const bytes = new Uint8Array(await readFile(path.join("tests", "fixtures", "13-nested-merged-tables.docx")));
    const { result, report } = await redline(bytes, [
      finding({ quoted_text: "Tier A fifty percent (50%)", language: "Tier A twenty-five percent (25%)" }),
    ]);
    expect(result.appliedCount).toBe(1);
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

describe("several changes to one table", () => {
  const TIERS = [
    ["Days Prior to Arrival", "Damages", "Catering"],
    ["365 or more", "25%", "$0"],
    ["364 to 181", "50%", "$10,000"],
    ["180 to 91", "75%", "$20,000"],
    ["90 to 31", "90%", "$30,000"],
    ["30 or fewer", "100%", "$40,000"],
  ];
  const NOTE = "Keeps the group's costs in line with the rooms it uses.";

  /** One finding per tier, each lowering the damages figure. */
  const tierFindings = (rows: number[]) =>
    rows.map((r) =>
      finding({
        id: `tier-${r}`,
        quoted_text: TIERS[r].join(" | "),
        language: [TIERS[r][0], `${r}0% of room profit`, TIERS[r][2]].join(" | "),
      })
    );

  async function withComments(originalBytes: Uint8Array, findings: RevisionFinding[]) {
    const comments = new Map(findings.map((f) => [f.id, NOTE]));
    const result = await generateRedline({ originalDocxBytes: originalBytes, findings, comments, author: AUTHOR });
    const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
    const zip = await JSZip.loadAsync(result.docxBytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    const commentsXml = (await zip.file("word/comments.xml")?.async("string")) ?? "";
    return { result, report, xml, commentsXml };
  }

  const tablesIn = (xml: string) => (xml.match(/<w:tbl>/g) ?? []).length;
  const failed = (report: { checks: { name: string; passed: boolean; detail: string }[] }) =>
    report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);

  it("puts two row changes into one copy of the table", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), tierFindings([1, 3]));

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    // One struck original and one copy, however many rows change.
    expect(tablesIn(xml)).toBe(2);
    expect(xml).toContain("10% of room profit");
    expect(xml).toContain("30% of room profit");
  });

  it("puts five row changes into one copy", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), tierFindings([1, 2, 3, 4, 5]));

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(5);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(2);
    for (const r of [1, 2, 3, 4, 5]) expect(xml).toContain(`${r}0% of room profit`);
  });

  it("issues every change id once", async () => {
    const { result, xml } = await redline(await buildDocx(table(TIERS)), tierFindings([1, 2, 3]));
    const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(result.ownRevisionIds).size).toBe(result.ownRevisionIds.length);
  });

  it("takes a one-cell change after a row change into the same copy", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), [
      ...tierFindings([1]),
      finding({ id: "cell", quoted_text: "$30,000", language: "$15,000" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(2);
    expect(xml).toContain("$15,000");
  });

  it("keeps the file valid when two findings change the same row", async () => {
    const [first] = tierFindings([2]);
    const second = finding({
      id: "again",
      quoted_text: first.language,
      language: [TIERS[2][0], "35% of room profit", TIERS[2][2]].join(" | "),
    });
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), [first, second]);

    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(2);
    expect(result.appliedCount + result.unapplied.length).toBe(2);
  });

  it("gives each finding its comment", async () => {
    const findings = tierFindings([1, 3, 5]);
    const { result, report, commentsXml } = await withComments(await buildDocx(table(TIERS)), findings);

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(3);
    expect((commentsXml.match(/<w:comment /g) ?? []).length).toBe(3);
  });

  it("leaves one table with every edit once our changes are accepted", async () => {
    const originalBytes = await buildDocx(table(TIERS));
    const result = await generateRedline({ originalDocxBytes: originalBytes, findings: tierFindings([1, 2, 4]), author: AUTHOR });
    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");

    expect(tablesIn(xml)).toBe(1);
    expect(xml).not.toMatch(/<w:(ins|del) /);
    for (const r of [1, 2, 4]) expect(xml).toContain(`${r}0% of room profit`);
    // The untouched tiers read as they did.
    expect(xml).toContain("75%");
    expect(xml).toContain("100%");
  });
});
