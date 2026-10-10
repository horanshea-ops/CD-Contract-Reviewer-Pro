import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { readPackage, validateRedline } from "@/lib/redline-validation";
import { checkComments } from "@/lib/redline-validation/structure";
import { W_NS, buildDocx, ins, para, run, table, zipParts, CONTENT_TYPES, ROOT_RELS, DOC_RELS, documentXml } from "../helpers/docx-package";

/**
 * Short "why" comments on our changes (§1.5.11, CLAUDE.md deviation 8).
 *
 * Every case goes through §1.6's oracle, so a comment can never be the reason
 * a file Word would refuse reaches an associate.
 */

const AUTHOR = "Jane Associate";
const NOTE = "Keeps the group's costs in line with the rooms it uses.";

function finding(over: Partial<RevisionFinding> = {}): RevisionFinding {
  return {
    id: "finding-1",
    clause_type: "attrition",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    location_section: null,
    ...over,
  };
}

async function redline(
  originalBytes: Uint8Array,
  findings: RevisionFinding[],
  comments: ReadonlyMap<string, string> = new Map(findings.map((f) => [f.id, NOTE]))
) {
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, comments, author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const zip = await JSZip.loadAsync(result.docxBytes);
  const read = async (p: string) => (await zip.file(p)?.async("string")) ?? null;
  return {
    result,
    report,
    zip,
    xml: (await read("word/document.xml"))!,
    comments: await read("word/comments.xml"),
    rels: await read("word/_rels/document.xml.rels"),
    types: await read("[Content_Types].xml"),
  };
}

const CLAUSE = "Group shall be liable for eighty percent (80%) of the group rate.";
const SWAP = finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" });

describe("a comment on a replacement", () => {
  it("writes the note, attributed to the associate, and passes the oracle", async () => {
    const { result, report, xml, comments } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);

    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
    expect(result.ownCommentIds).toHaveLength(1);
    const [id] = result.ownCommentIds;

    expect(comments).toContain(`w:id="${id}"`);
    expect(comments).toContain(`w:author="${AUTHOR}"`);
    expect(comments).toContain(`w:initials="JA"`);
    expect(comments).toContain(NOTE);
    for (const tag of ["commentRangeStart", "commentRangeEnd", "commentReference"]) {
      expect(xml).toContain(`<w:${tag} w:id="${id}"/>`);
    }
  });

  it("covers the change, with the reference after it", async () => {
    const { xml, result } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);
    const id = result.ownCommentIds[0];
    const start = xml.indexOf(`<w:commentRangeStart w:id="${id}"/>`);
    const end = xml.indexOf(`<w:commentRangeEnd w:id="${id}"/>`);
    const ref = xml.indexOf(`<w:commentReference w:id="${id}"/>`);
    expect(start).toBeLessThan(xml.indexOf("seventy percent"));
    expect(end).toBeGreaterThan(xml.indexOf("eighty percent (80%)</w:delText>"));
    expect(ref).toBeGreaterThan(end);
  });

  it("creates comments.xml with its relationship and content type", async () => {
    const { rels, types, result } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);
    expect(result.createdCommentsPart).toBe(true);
    expect(rels).toMatch(/Type="[^"]*\/relationships\/comments" Target="comments\.xml"/);
    expect(types).toContain(
      `PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"`
    );
    expect(rels!.match(/xmlns=/g)).toHaveLength(1);
  });

  it("gives comment ids no revision already uses", async () => {
    const { xml, result } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);
    const revisionIds = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map((m) => m[1]);
    for (const id of result.ownCommentIds) expect(revisionIds).not.toContain(id);
  });
});

describe("when there is nothing to say", () => {
  it("adds no part when no finding has a note", async () => {
    const { comments, result, report, rels } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP], new Map());
    expect(comments).toBeNull();
    expect(result.ownCommentIds).toEqual([]);
    expect(result.createdCommentsPart).toBe(false);
    expect(rels).not.toContain("comments");
    expect(report.outcome).toBe("clean");
  });

  it("skips a blank note", async () => {
    const { comments } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP], new Map([[SWAP.id, "   "]]));
    expect(comments).toBeNull();
  });

  it("gives a refused finding no comment", async () => {
    const lost = finding({ id: "lost", quoted_text: "wording not in this contract", language: "replacement" });
    const { result } = await redline(await buildDocx(para(run(CLAUSE))), [lost]);
    expect(result.appliedCount).toBe(0);
    expect(result.ownCommentIds).toEqual([]);
  });
});

describe("where the comment is anchored", () => {
  it("sits outside the property's own insertion", async () => {
    const body = para(
      run("Damages are ") + ins(500, "Dana Reyes", run("ninety percent (90%)")) + run(" of room revenue.")
    );
    const { xml, report, result } = await redline(await buildDocx(body), [
      finding({ quoted_text: "ninety percent (90%)", language: "seventy percent (70%)" }),
    ]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    const id = result.ownCommentIds[0];
    const theirs = xml.slice(xml.indexOf('<w:ins w:id="500"'), xml.indexOf("</w:ins>", xml.indexOf('<w:ins w:id="500"')));
    expect(theirs).not.toContain("comment");
    expect(xml).toContain(`<w:commentReference w:id="${id}"/>`);
  });

  it("annotates a row change inside its table", async () => {
    const SCHEDULE = [
      ["Days Prior to Arrival", "Damages"],
      ["180 to 91", "50%"],
    ];
    const { xml, report, result } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
    ]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    const start = xml.indexOf(`<w:commentRangeStart w:id="${result.ownCommentIds[0]}"/>`);
    expect(start).toBeGreaterThan(xml.indexOf("<w:tbl>"));
    expect(start).toBeLessThan(xml.indexOf("</w:tbl>"));
  });

  it("annotates a replaced table on its new copy", async () => {
    const SCHEDULE = [
      ["Days Prior to Arrival", "Damages"],
      ["180 to 91", "50%"],
    ];
    // The second finding changes wording the first already changed, which replaces the table.
    const { xml, report, result } = await redline(await buildDocx(table(SCHEDULE)), [
      finding({ id: "first", quoted_text: "180 to 91 | 50%", language: "180 to 91 | 25%" }),
      finding({ id: "second", quoted_text: "180 to 91 | 25%", language: "180 to 91 | 20%" }),
    ]);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.unapplied).toEqual([]);
    const secondTable = xml.indexOf("<w:tbl>", xml.indexOf("<w:tbl>") + 1);
    expect(secondTable).toBeGreaterThan(-1);
    expect(xml.indexOf(`<w:commentRangeStart w:id="${result.ownCommentIds[1]}"/>`)).toBeGreaterThan(secondTable);
  });

  it("annotates each appended clause, and not the heading", async () => {
    const added = [
      finding({ id: "a", is_missing_clause: true, language: "Hotel shall credit resold rooms against attrition." }),
      finding({ id: "b", is_missing_clause: true, language: "Hotel shall notify the group of any renovation." }),
    ];
    const { xml, report, result } = await redline(
      await buildDocx(para(run(CLAUSE))),
      added,
      new Map([
        ["a", "Credits the group for rooms the hotel resells."],
        ["b", "Gives the group notice of works that affect the event."],
      ])
    );
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.ownCommentIds).toHaveLength(2);
    const heading = xml.indexOf("Additional Provisions");
    expect(xml.indexOf("<w:commentRangeStart")).toBeGreaterThan(heading);
    const [first, second] = result.ownCommentIds;
    expect(xml.indexOf(`<w:commentRangeStart w:id="${first}"/>`)).toBeLessThan(xml.indexOf("credit resold rooms"));
    expect(xml.indexOf(`<w:commentRangeStart w:id="${second}"/>`)).toBeGreaterThan(xml.indexOf("credit resold rooms"));
  });

  it("leaves a header change uncommented, and says so", async () => {
    const originalBytes = new Uint8Array(await readFile(path.join("tests", "fixtures", "06-header-footer-terms.docx")));
    const f = finding({ quoted_text: "thirty (30) days", language: "sixty (60) days" });
    const { result, report, comments } = await redline(originalBytes, [f]);
    expect(result.appliedCount).toBe(1);
    expect(comments).toBeNull();
    expect(report.outcome).toBe("clean");
    expect(result.resolutions[0].detail).toContain("Word doesn't allow comments in headers and footers");
  });
});

describe("a document that already has comments (fixture 15)", () => {
  const FIXTURE = path.join("tests", "fixtures", "15-links-footnotes-comments.docx");

  it("adds ours beside the property's, with fresh ids", async () => {
    const originalBytes = new Uint8Array(await readFile(FIXTURE));
    const { result, report, comments, rels, types } = await redline(originalBytes, [
      finding({ id: "x", quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" }),
    ]);

    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.createdCommentsPart).toBe(false);
    expect(comments).toContain("Confirm this matches the signed LOI.");
    expect(comments).toContain(NOTE.slice(0, 20));
    expect(result.ownCommentIds).not.toContain("1");
    expect(Number(result.ownCommentIds[0])).toBeGreaterThan(1);
    expect(rels!.match(/relationships\/comments"/g)).toHaveLength(1);
    expect(types!.match(/comments\+xml/g)).toHaveLength(1);
  });
});

describe("what a comment can carry", () => {
  it("never writes a finding's own text anywhere in the file", async () => {
    // A finding that reaches the engine with CD's reasoning still leaves none
    // of it in the file. Comment text comes only from the comments map.
    const leaky = {
      ...finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" }),
      finding_text: "SENTINEL-FINDING-TEXT",
      cd_standard: "SENTINEL-CD-STANDARD",
    };
    const { zip } = await redline(await buildDocx(para(run(CLAUSE))), [leaky]);
    for (const name of Object.keys(zip.files).filter((n) => !zip.files[n].dir)) {
      const text = await zip.file(name)!.async("string");
      expect(text).not.toContain("SENTINEL");
    }
  });
});

describe("the comments_consistent check", () => {
  const COMMENTS = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments ${W_NS}>${inner}</w:comments>`;
  const body = (id: string) =>
    para(`<w:commentRangeStart w:id="${id}"/>${run(CLAUSE)}<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
  const comment = (id: string) => `<w:comment w:id="${id}" w:author="A"><w:p>${run("Note")}</w:p></w:comment>`;

  async function pkg(docBody: string, commentsXml: string | null) {
    const parts: Record<string, string> = {
      "[Content_Types].xml": CONTENT_TYPES,
      "_rels/.rels": ROOT_RELS,
      "word/document.xml": documentXml(docBody),
      "word/_rels/document.xml.rels": DOC_RELS,
    };
    if (commentsXml) parts["word/comments.xml"] = commentsXml;
    const read = await readPackage(await zipParts(parts));
    if (!read.ok) throw new Error(read.error);
    return read.pkg;
  }

  /** Checks an output against a plain original, unless the original is given. */
  async function check(
    docBody: string,
    commentsXml: string | null,
    own: string[] = [],
    original?: { body: string; comments: string | null },
    ownRevisions: string[] = []
  ) {
    const input = original ? await pkg(original.body, original.comments) : await pkg(para(run(CLAUSE)), null);
    return checkComments(input, await pkg(docBody, commentsXml), own, new Set(ownRevisions));
  }

  it("fails when one of our changes wraps a comment the file already had", async () => {
    const original = { body: body("1"), comments: COMMENTS(comment("1")) };
    const wrapped = para(
      `<w:commentRangeStart w:id="1"/><w:commentRangeEnd w:id="1"/>` +
        `<w:del w:id="900" w:author="Us"><w:r><w:commentReference w:id="1"/></w:r>` +
        `<w:r><w:delText xml:space="preserve">${CLAUSE}</w:delText></w:r></w:del>`
    );
    const result = await check(wrapped, original.comments, [], original, ["900"]);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("wraps a comment");
  });

  it("fails when a comment the file already had loses a marker", async () => {
    const original = { body: body("1"), comments: COMMENTS(comment("1")) };
    const lost = para(`<w:commentRangeStart w:id="1"/>${run(CLAUSE)}<w:commentRangeEnd w:id="1"/>`);
    const result = await check(lost, original.comments, [], original);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("lost");
  });

  it("passes a comment the property wrapped in its own change", async () => {
    const theirs = para(
      `<w:commentRangeStart w:id="1"/><w:ins w:id="5" w:author="Them">${run(CLAUSE)}` +
        `<w:r><w:commentReference w:id="1"/></w:r></w:ins><w:commentRangeEnd w:id="1"/>`
    );
    const original = { body: theirs, comments: COMMENTS(comment("1")) };
    expect((await check(theirs, original.comments, [], original, ["900"])).passed).toBe(true);
  });

  it("passes a document whose comments resolve", async () => {
    expect((await check(body("1"), COMMENTS(comment("1")), ["1"])).passed).toBe(true);
  });

  it("fails a reference to a comment that is not there", async () => {
    const result = await check(body("1"), COMMENTS(comment("2")));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("not in the file");
  });

  it("fails two comments sharing an id", async () => {
    const result = await check(body("1"), COMMENTS(comment("1") + comment("1")));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("share id");
  });

  it("fails one of ours written without its end marker", async () => {
    const half = para(`<w:commentRangeStart w:id="7"/>${run(CLAUSE)}<w:r><w:commentReference w:id="7"/></w:r>`);
    const result = await check(half, COMMENTS(comment("7")), ["7"]);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("w:commentRangeEnd");
  });

  it("tolerates the property's own unpaired range", async () => {
    const theirs = para(`<w:commentRangeStart w:id="3"/>${run(CLAUSE)}`);
    expect((await check(theirs, COMMENTS(comment("3")))).passed).toBe(true);
  });

  it("does not fail a dangling reference the property sent", async () => {
    // Fixture 14 is one: a reference with no comments part at all.
    const result = await check(body("1"), null, [], { body: body("1"), comments: null });
    expect(result.passed).toBe(true);
  });
});
