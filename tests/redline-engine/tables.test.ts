import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { acceptOwnRevisions } from "@/lib/docx-accept";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { CONTENT_TYPES, ROOT_RELS, W_NS, buildDocx, docRelsXml, documentXml, para, run, table, zipParts } from "../helpers/docx-package";

/**
 * Changes that span table cells (the user's decision of 2026-10-08).
 *
 * Each cell takes its own in-place change and the table stays where it is. A
 * change that can't be placed cell by cell strikes the table and inserts an
 * edited copy. The oracle is the real test of both routes.
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

const tablesIn = (xml: string) => (xml.match(/<w:tbl>/g) ?? []).length;
const failed = (report: { checks: { name: string; passed: boolean; detail: string }[] }) =>
  report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`);
const count = (xml: string, pattern: RegExp) => (xml.match(pattern) ?? []).length;

/** A table whose cells can hold several paragraphs, one per string. */
function linedTable(rows: (string | string[])[][]): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const grid = `<w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="2000"/>`).join("")}</w:tblGrid>`;
  const body = rows
    .map(
      (cells) =>
        `<w:tr>${cells
          .map((c) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${[c].flat().map((line) => para(run(line))).join("")}</w:tc>`)
          .join("")}</w:tr>`
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${body}</w:tbl>`;
}

const FB = [
  ["Days Prior to Arrival", "Catering Damages"],
  ["180 to 91", ["$50,000", "[$100,000 times 50%]"]],
  ["90 to 31", ["$80,000", "[80% of the minimum]"]],
];

/** Changes the amount and the first word of its formula, so no unchanged word sits between the two lines. */
const STRADDLE = finding({
  id: "straddle",
  quoted_text: "90 to 31 | $80,000 [80% of the minimum]",
  language: "90 to 31 | $35,000 [35% of the minimum]",
});

/** Two findings on one row of SCHEDULE. The second changes wording the first put in, which takes the table's copy. */
const TWICE = [
  finding({ id: "first", quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
  finding({ id: "second", quoted_text: "180 to 91 | 25%", language: "180 to 91 | 20%" }),
];

describe("a change spanning cells", () => {
  it("changes the cell in place and leaves the table alone", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toMatch(/<w:delText[^>]*>50%<\/w:delText>/);
    expect(xml).toMatch(/<w:t [^>]*>25%<\/w:t>/);
    // The cell that reads the same carries no mark.
    expect(count(xml, /<w:ins /g)).toBe(1);
    expect(count(xml, /<w:del /g)).toBe(1);
  });

  it("marks no row as struck or added", async () => {
    const { xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);

    expect(xml).not.toMatch(/<w:trPr>/);
  });

  it("gives each changed cell its own change", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "120 to 91 | 25%" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toMatch(/<w:delText[^>]*>180<\/w:delText>/);
    expect(xml).toMatch(/<w:delText[^>]*>50%<\/w:delText>/);
  });

  it("lays out a row written with a separator at each end", async () => {
    // The shape a real review wrote: the row as the extracted text shows it, edges included.
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "| 180 to 91 | 50% |", language: "| 180 to 91  | 25%  |" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toContain("25%");
  });

  it("places a proposal written without separators", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 25%" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toMatch(/<w:t [^>]*>25%<\/w:t>/);
  });

  it("refuses when the proposed wording does not lay back out across the cells", async () => {
    // Wording in the wrong column is worse than a finding the associate has to
    // raise by hand, so a mismatch is refused rather than guessed at.
    const { result, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "Damages are reduced to twenty-five percent." }),
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.unapplied[0].reason).toBe("crosses_boundary");
    expect(tablesIn(xml)).toBe(1);
  });
});

describe("a cell holding two paragraphs", () => {
  it("takes a change to each line, in place", async () => {
    const { result, report, xml } = await redline(await buildDocx(linedTable(FB)), [
      finding({ quoted_text: "180 to 91 | $50,000 [$100,000 times 50%]", language: "180 to 91 | $35,000 [$100,000 times 35%]" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toMatch(/<w:delText[^>]*>\$50,000<\/w:delText>/);
    expect(xml).toMatch(/<w:delText[^>]*>50%\]<\/w:delText>/);
  });

  it("rewrites both lines in the cell when the change can't be laid across them", async () => {
    const original = await buildDocx(linedTable(FB));
    const { result, report, xml } = await redline(original, [STRADDLE]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
    expect(xml).not.toMatch(/<w:trPr>/);

    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const accepted = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");
    expect(accepted).toContain("$35,000 [35% of the minimum]");
    expect(accepted).not.toContain("$80,000");
  });
});

describe("the struck table and its copy", () => {
  it("replaces the table when a second finding changes wording the first already changed", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), TWICE);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    // Two tables in the file, one struck and one added.
    expect(tablesIn(xml)).toBe(2);
    expect(xml).toContain("20%");
    expect(result.resolutions[1].detail).toMatch(/table is replaced/);
  });

  it("marks the rows themselves, not just the text", async () => {
    // Without the row markers Word renders the table wrongly — the same class
    // of omission as the paragraph-mark bug Stage 0 found.
    const { xml } = await redline(await buildDocx(table(SCHEDULE)), TWICE);

    expect(xml).toMatch(/<w:trPr><w:del /);
    expect(xml).toMatch(/<w:trPr><w:ins /);
  });

  it("keeps the tables apart so Word does not merge them", async () => {
    const { xml } = await redline(await buildDocx(table(SCHEDULE)), TWICE);
    // A paragraph between the two, or Word renders them as one table.
    expect(xml).toMatch(/<\/w:tbl><w:p>[\s\S]*?<\/w:p><w:tbl>/);
  });

  it("carries the original's formatting into the copy rather than rebuilding it", async () => {
    const shaded =
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="8"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="1500"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr>${para(run("180 to 91"))}</w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1500" w:type="dxa"/></w:tcPr>${para(run("50%"))}</w:tc></w:tr></w:tbl>`;
    const { xml } = await redline(await buildDocx(shaded), TWICE);

    // Borders, shading and column widths appear twice — once per table.
    expect(count(xml, /w:fill="D9D9D9"/g)).toBe(2);
    expect(count(xml, /<w:gridCol w:w="3000"\/>/g)).toBe(2);
    expect(count(xml, /<w:tblBorders>/g)).toBe(2);
  });
});

describe("a change inside one cell", () => {
  it("is edited in place, leaving the table alone", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "50%", language: "25%" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
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
    expect(failed(report)).toEqual([]);
  });

  it("handles a table that already carries the counterparty's changes", async () => {
    const bytes = new Uint8Array(await readFile(path.join("tests", "fixtures", "09-tracked-in-tables.docx")));
    const { report } = await redline(bytes, [
      finding({ quoted_text: "seventy-five percent (75%)", language: "sixty percent (60%)" }),
    ]);
    expect(failed(report)).toEqual([]);
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

  /** A second change to the wording tier 2's finding has already put in. */
  const again = (wording = "35% of room profit") =>
    finding({
      id: "again",
      quoted_text: tierFindings([2])[0].language,
      language: [TIERS[2][0], wording, TIERS[2][2]].join(" | "),
    });

  async function withComments(originalBytes: Uint8Array, findings: RevisionFinding[]) {
    const comments = new Map(findings.map((f) => [f.id, NOTE]));
    const result = await generateRedline({ originalDocxBytes: originalBytes, findings, comments, author: AUTHOR });
    const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
    const zip = await JSZip.loadAsync(result.docxBytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    const commentsXml = (await zip.file("word/comments.xml")?.async("string")) ?? "";
    return { result, report, xml, commentsXml };
  }

  it("makes two row changes in the one table", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), tierFindings([1, 3]));

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toContain("10% of room profit");
    expect(xml).toContain("30% of room profit");
  });

  it("makes five row changes in the one table", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), tierFindings([1, 2, 3, 4, 5]));

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(5);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    for (const r of [1, 2, 3, 4, 5]) expect(xml).toContain(`${r}0% of room profit`);
  });

  it("issues every change id once", async () => {
    const { result, xml } = await redline(await buildDocx(table(TIERS)), [...tierFindings([1, 2, 3]), again()]);
    const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(result.ownRevisionIds).size).toBe(result.ownRevisionIds.length);
  });

  it("takes a one-cell change after a row change", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), [
      ...tierFindings([1]),
      finding({ id: "cell", quoted_text: "$30,000", language: "$15,000" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(xml).toContain("$15,000");
  });

  it("replaces the table when a second finding changes wording the first already changed", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), [...tierFindings([2]), again()]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(2);
  });

  it("makes every later change in the one copy of a replaced table", async () => {
    const { result, report, xml } = await redline(await buildDocx(table(TIERS)), [
      ...tierFindings([2]),
      again(),
      ...tierFindings([4]),
      finding({ id: "cell", quoted_text: "$40,000", language: "$15,000" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(4);
    expect(failed(report)).toEqual([]);
    // One struck original and one copy, however many changes follow.
    expect(tablesIn(xml)).toBe(2);
    expect(xml).toContain("40% of room profit");
    expect(xml).toContain("$15,000");
  });

  it("gives each finding its comment", async () => {
    const findings = tierFindings([1, 3, 5]);
    const { result, report, commentsXml } = await withComments(await buildDocx(table(TIERS)), findings);

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(3);
    expect(count(commentsXml, /<w:comment /g)).toBe(3);
  });

  it("gives each finding its comment when the table is replaced", async () => {
    const findings = [...tierFindings([2]), again(), ...tierFindings([4])];
    const { result, report, commentsXml } = await withComments(await buildDocx(table(TIERS)), findings);

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(3);
    expect(count(commentsXml, /<w:comment /g)).toBe(3);
  });

  it.each([
    ["in place", tierFindings([1, 2, 4])],
    ["through a copy", [...tierFindings([1, 2]), again("20% of room profit "), ...tierFindings([4])]],
  ])("leaves one table with every edit once our changes are accepted, %s", async (_route, findings) => {
    const originalBytes = await buildDocx(table(TIERS));
    const result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: AUTHOR });
    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");

    expect(result.unapplied).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(xml).not.toMatch(/<w:(ins|del) /);
    for (const r of [1, 2, 4]) expect(xml).toContain(`${r}0% of room profit`);
    // The untouched tiers read as they did.
    expect(xml).toContain("75%");
    expect(xml).toContain("100%");
  });
});

describe("a table that already holds tracked changes", () => {
  const HOTEL = "Dana Reyes";
  const fixture09 = async () => new Uint8Array(await readFile(path.join("tests", "fixtures", "09-tracked-in-tables.docx")));
  const byHotel = (xml: string) => count(xml, new RegExp(`w:author="${HOTEL}"`, "g"));

  /** Each table's XML, in document order. After a replacement the first is the struck original, the second our copy. */
  const tables = (xml: string) => xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];

  const ROW = finding({ quoted_text: "180 to 91 | seventy-five percent (75%)", language: "180 to 91 | sixty percent (60%)" });
  const ROW_AGAIN = finding({
    id: "again",
    quoted_text: "180 to 91 | sixty percent (60%)",
    language: "180 to 91 | fifty-five percent (55%)",
  });

  it("changes a row the counterparty has edited, in place", async () => {
    const { result, report, xml } = await redline(await fixture09(), [ROW]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tables(xml)).toHaveLength(1);
    expect(byHotel(xml)).toBe(4);
    expect(xml).toContain("sixty percent (60%)");
  });

  it("replaces a table the counterparty has edited", async () => {
    const { result, report, xml } = await redline(await fixture09(), [ROW, ROW_AGAIN]);

    expect(result.unapplied).toEqual([]);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tables(xml)).toHaveLength(2);
  });

  it("keeps the counterparty's changes on the struck table and none in the copy", async () => {
    const { xml } = await redline(await fixture09(), [ROW, ROW_AGAIN]);
    const [struck = "", copy = ""] = tables(xml);

    expect(byHotel(struck)).toBe(4);
    expect(byHotel(copy)).toBe(0);
    // The copy reads as the table read when it arrived, with our change.
    expect(copy).toContain("fifty-five percent (55%)");
    expect(copy).toContain("ninety percent (90%)");
    expect(copy).not.toContain("fifty percent (50%)");
  });

  it("takes a row change after a one-cell change to the same table", async () => {
    const SCHEDULE3 = [...SCHEDULE, ["90 or fewer", "90%"]];
    const { result, report, xml } = await redline(await buildDocx(table(SCHEDULE3)), [
      finding({ id: "cell", quoted_text: "25%", language: "10%" }),
      finding({ id: "row", quoted_text: "180 to 91 | 50%", language: "180 to 91 | 35%" }),
    ]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(tables(xml)).toHaveLength(1);

    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const accepted = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");
    expect(tables(accepted)).toHaveLength(1);
    expect(accepted).toContain("10%");
    expect(accepted).toContain("35%");
    expect(accepted).not.toContain("25%");
  });

  describe("a formatting change", () => {
    /** Wording the property made bold, with the change tracked. */
    const reformatted = (text: string) =>
      `<w:r><w:rPr><w:b/><w:rPrChange w:id="77" w:author="${HOTEL}" w:date="2026-03-01T00:00:00Z"><w:rPr/></w:rPrChange></w:rPr>` +
      `<w:t xml:space="preserve">${text}</w:t></w:r>`;
    const bodyWith = (text: string) => table(SCHEDULE).replace(run(text), reformatted(text)) + para(run("Deposits are due at signing."));
    const PROSE = finding({ id: "prose", quoted_text: "Deposits are due at signing.", language: "Deposits are due thirty days after signing." });
    const ROW_50 = finding({ id: "row", quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" });

    it("changes the row in place and copies the formatting without its change record", async () => {
      const { result, report, xml } = await redline(await buildDocx(bodyWith("50%")), [ROW_50, PROSE]);

      expect(result.unapplied).toEqual([]);
      expect(result.appliedCount).toBe(2);
      expect(failed(report)).toEqual([]);
      expect(tables(xml)).toHaveLength(1);
      expect(xml).toMatch(/<w:ins [^>]*><w:r><w:rPr><w:b\/><\/w:rPr><w:t [^>]*>25%/);
      expect(count(xml, /<w:rPrChange /g)).toBe(1);
    });

    it("refuses to copy a table whose copy would carry it, and leaves the rest valid", async () => {
      const { result, report, xml } = await redline(await buildDocx(bodyWith("25%")), [
        ROW_50,
        finding({ id: "again", quoted_text: "180 to 91 | 25%", language: "180 to 91 | 20%" }),
        PROSE,
      ]);

      expect(result.appliedCount).toBe(2);
      expect(result.unapplied.map((u) => u.reason)).toEqual(["crosses_boundary"]);
      expect(result.resolutions.find((r) => r.findingId === "again")?.detail).toMatch(/tracked change/i);
      expect(failed(report)).toEqual([]);
      expect(tables(xml)).toHaveLength(1);
    });
  });
});

describe("a table holding the property's comment", () => {
  const NOTE = "Keeps the group's costs in line with the rooms it uses.";
  const HOTEL_COMMENTS =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W_NS}>` +
    `<w:comment w:id="1" w:author="Dana Reyes"><w:p>${run("Our revenue team set these tiers.")}</w:p></w:comment></w:comments>`;
  const TYPES = CONTENT_TYPES.replace(
    "</Types>",
    `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`
  );

  /** The wording with the property's comment anchored on it. */
  const noted = (text: string) =>
    `<w:commentRangeStart w:id="1"/>${run(text)}<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>`;

  const withHotelComment = (body: string) =>
    zipParts({
      "[Content_Types].xml": TYPES,
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": documentXml(body),
      "word/_rels/document.xml.rels": docRelsXml([{ id: "rId9", type: "comments", target: "comments.xml" }]),
      "word/comments.xml": HOTEL_COMMENTS,
    });

  const markers = (xml: string) => [
    count(xml, /<w:commentRangeStart w:id="1"\/>/g),
    count(xml, /<w:commentRangeEnd w:id="1"\/>/g),
    count(xml, /<w:commentReference w:id="1"\/>/g),
  ];

  const PROSE = para(run("Deposits are due at signing."));
  const ROW = finding({ id: "row", quoted_text: "180 to 91 | 50%", language: "180 to 91 | 35%" });
  const DEPOSIT = finding({ id: "prose", quoted_text: "Deposits are due at signing.", language: "Deposits are due thirty days after signing." });

  it.each([
    ["the changed row", "50%"],
    ["another row", "25%"],
  ])("changes the row in place when the comment sits on %s", async (_where, commented) => {
    const body = table(SCHEDULE).replace(run(commented), noted(commented)) + PROSE;
    const { result, report, xml } = await redline(await withHotelComment(body), [ROW, DEPOSIT]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(tablesIn(xml)).toBe(1);
    expect(markers(xml)).toEqual([1, 1, 1]);
    expect(xml).toMatch(/<w:t [^>]*>35%<\/w:t>/);
  });

  it("keeps the comment once our changes are accepted", async () => {
    const original = await withHotelComment(table(SCHEDULE).replace(run("50%"), noted("50%")));
    const result = await generateRedline({ originalDocxBytes: original, findings: [ROW], author: AUTHOR });
    const clean = await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds));
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");

    expect(markers(xml)).toEqual([1, 1, 1]);
    expect(xml).toContain("35%");
    expect(xml).not.toContain("50%");
  });

  it("adds our own comment beside the property's", async () => {
    const original = await withHotelComment(table(SCHEDULE).replace(run("50%"), noted("50%")));
    const result = await generateRedline({
      originalDocxBytes: original,
      findings: [ROW],
      comments: new Map([[ROW.id, NOTE]]),
      author: AUTHOR,
    });
    const report = await validateRedline({ originalBytes: original, engineResult: result, author: AUTHOR });
    const commentsXml = await (await JSZip.loadAsync(result.docxBytes)).file("word/comments.xml")!.async("string");

    expect(failed(report)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(1);
    expect(count(commentsXml, /<w:comment /g)).toBe(2);
  });

  it("rewrites both lines of a cell in place, on a table that holds a comment", async () => {
    const body = linedTable(FB).replace(run("$50,000"), noted("$50,000")) + PROSE;
    const { result, report, xml } = await redline(await withHotelComment(body), [STRADDLE, DEPOSIT]);

    expect(result.unapplied).toEqual([]);
    expect(result.appliedCount).toBe(2);
    expect(failed(report)).toEqual([]);
    expect(tablesIn(xml)).toBe(1);
    expect(markers(xml)).toEqual([1, 1, 1]);
  });

  it("leaves out a change that would need the table copied, and keeps the rest", async () => {
    const body = table(SCHEDULE).replace(run("25%"), noted("25%")) + PROSE;
    const { result, report, xml } = await redline(await withHotelComment(body), [...TWICE, DEPOSIT]);

    expect(result.appliedCount).toBe(2);
    expect(result.unapplied.map((u) => u.reason)).toEqual(["table_holds_comment"]);
    expect(failed(report)).toEqual([]);
    expect(report.outcome).not.toBe("fallback");
    expect(tablesIn(xml)).toBe(1);
    expect(markers(xml)).toEqual([1, 1, 1]);
  });
});
