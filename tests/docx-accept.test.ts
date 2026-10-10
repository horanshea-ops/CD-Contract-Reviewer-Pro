import { describe, expect, it } from "vitest";
import { acceptOwnRevisions } from "@/lib/docx-accept";
import { tableGrids } from "@/lib/docx/table-grid";
import { generateRedline } from "@/lib/redline-engine";
import { readPackage } from "@/lib/redline-validation";
import { allRevisions, elementsByTag } from "@/lib/redline-validation/package";
import { currentText } from "@/lib/redline-validation/views";
import JSZip from "jszip";
import { buildNumberedDocx, esc } from "./helpers/docx-package";
import { FIXTURE_AUTHOR, FIXTURE_CORPUS, readFixture } from "./helpers/fixture-corpus";

/**
 * The clean Word copy (lib/docx-accept.ts): the redline with this export's own
 * changes accepted.
 *
 * It must read exactly as the redline does with every change accepted, keep no
 * revision of ours, keep every revision the property sent, and end with the
 * same tables the original had, since a replaced table is struck and re-inserted.
 */

const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

async function read(bytes: Uint8Array) {
  const r = await readPackage(bytes);
  if (!r.ok) throw new Error(r.error);
  return r.pkg;
}

const NOTE = "Keeps the group's costs in line with the rooms it uses.";

/** The redline with a comment on every change, and its clean copy. */
async function redlineAndAccept(index: number) {
  const { file, findings } = FIXTURE_CORPUS[index];
  const originalBytes = new Uint8Array(await readFixture(file));
  const result = await generateRedline({
    originalDocxBytes: originalBytes,
    findings,
    comments: new Map(findings.map((f) => [f.id, NOTE])),
    author: FIXTURE_AUTHOR,
  });
  const own = new Set(result.ownRevisionIds);
  const clean = await acceptOwnRevisions(result.docxBytes, own, {
    ids: new Set(result.ownCommentIds),
    createdPart: result.createdCommentsPart,
  });
  return { originalBytes, result, own, clean };
}

describe("accepting this export's changes", () => {
  it.each(FIXTURE_CORPUS.map((c, i) => [i, c.file] as const))("%i %s", async (index) => {
    const { originalBytes, result, own, clean } = await redlineAndAccept(index);
    const [original, redline, accepted] = await Promise.all([read(originalBytes), read(result.docxBytes), read(clean)]);

    expect(accepted.parseErrors).toEqual([]);
    expect(allRevisions(accepted).filter((r) => own.has(r.id))).toEqual([]);
    expect(allRevisions(accepted).length).toBe(allRevisions(original).length);
    expect(alnum(currentText(accepted))).toBe(alnum(currentText(redline)));

    const tables = (pkg: typeof original) => elementsByTag(pkg.xmlParts.get("word/document.xml")!.doc, "w:tbl").length;
    expect(tables(accepted)).toBe(tables(original));

    // Our comments go, the property's stay, and the package has the parts it arrived with.
    const commentIds = (pkg: typeof original, tag: string) =>
      [...pkg.xmlParts.values()].flatMap((p) => elementsByTag(p.doc, tag).map((el) => el.getAttribute("w:id")));
    for (const tag of ["w:comment", "w:commentRangeStart", "w:commentRangeEnd", "w:commentReference"]) {
      expect(commentIds(accepted, tag).sort()).toEqual(commentIds(original, tag).sort());
    }
    expect(accepted.entries).toEqual(original.entries);
  });

  it("applies the proposed wording", async () => {
    const { file, findings } = FIXTURE_CORPUS[0];
    const result = await generateRedline({
      originalDocxBytes: new Uint8Array(await readFixture(file)),
      findings,
      author: FIXTURE_AUTHOR,
    });
    const text = alnum(currentText(await read(await acceptOwnRevisions(result.docxBytes, new Set(result.ownRevisionIds)))));
    expect(text).toContain("seventypercent70");
    expect(text).not.toContain("eightypercent80");
  });
});

/**
 * The file the user opened in Word for the web on 2026-10-09, rebuilt here.
 * After Accept All, Word showed "AAA BBB" on one centred line and the new
 * wording as numbered clause 2, with no indent. The clean copy must match.
 */
describe("joining paragraphs whose breaks this export deleted", () => {
  const WHO = `w:author="${FIXTURE_AUTHOR}" w:date="2026-10-08T00:00:00Z"`;
  const t = (text: string) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const struck = (id: number, text: string) =>
    `<w:del w:id="${id}" ${WHO}><w:r><w:delText xml:space="preserve">${esc(text)}</w:delText></w:r></w:del>`;
  const added = (id: number, text: string) => `<w:ins w:id="${id}" ${WHO}>${t(text)}</w:ins>`;
  /** A paragraph. A `breakId` marks its break as deleted. */
  const p = (props: string, inner: string, breakId?: number) =>
    `<w:p><w:pPr>${props}${breakId ? `<w:rPr><w:del w:id="${breakId}" ${WHO}/></w:rPr>` : ""}</w:pPr>${inner}</w:p>`;
  const NUM = `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`;
  const SUB = `<w:ind w:left="1620" w:hanging="540"/>`;

  const body =
    p(`<w:jc w:val="center"/>`, t("AAA "), 9001) +
    p(`<w:jc w:val="right"/>`, t("BBB")) +
    p(NUM, t("Hotel will give notice of any renovation.")) +
    p(NUM, added(9002, "NEW WORDING. Hotel will relocate the meeting at its own cost.") + struck(9003, "We may then elect, within fifteen days,"), 9004) +
    p(SUB, struck(9005, "(A) to relocate your meeting, or"), 9006) +
    p(SUB, struck(9007, "(B) to refund your deposit.")) +
    p(NUM, t("This paragraph stays."));
  const own = new Set(["9001", "9002", "9003", "9004", "9005", "9006", "9007"]);

  async function acceptedParagraphs() {
    const clean = await acceptOwnRevisions(await buildNumberedDocx(body), own);
    const xml = await (await JSZip.loadAsync(clean)).file("word/document.xml")!.async("string");
    return (xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []).map((paragraph) => ({
      text: [...paragraph.matchAll(/<w:t[^>]*>([^<]*)</g)].map((m) => m[1]).join(""),
      xml: paragraph,
    }));
  }

  it("leaves the paragraphs Word left", async () => {
    expect((await acceptedParagraphs()).map((x) => x.text)).toEqual([
      "AAA BBB",
      "Hotel will give notice of any renovation.",
      "NEW WORDING. Hotel will relocate the meeting at its own cost.",
      "This paragraph stays.",
    ]);
  });

  it("gives two joined paragraphs the first one's formatting", async () => {
    const [joined] = await acceptedParagraphs();
    expect(joined.xml).toContain(`<w:jc w:val="center"/>`);
    expect(joined.xml).not.toContain(`w:val="right"`);
  });

  it("gives a chain of three the first one's formatting", async () => {
    const rewritten = (await acceptedParagraphs())[2];
    expect(rewritten.xml).toContain("<w:numPr>");
    expect(rewritten.xml).not.toContain("<w:ind ");
  });

  it("leaves no mark of ours behind", async () => {
    for (const { xml } of await acceptedParagraphs()) expect(xml).not.toMatch(/<w:(ins|del) /);
  });
});

describe("table grids", () => {
  it("reads column widths and merged cells for each top-level table", async () => {
    const grids = await tableGrids(new Uint8Array(await readFixture("13-nested-merged-tables.docx")));
    expect(grids.length).toBeGreaterThan(0);
    for (const g of grids) {
      expect(g.columns.length).toBeGreaterThan(0);
      for (const spans of g.rows) expect(spans.reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(g.columns.length);
    }
    expect(grids.some((g) => g.rows.some((spans) => spans.some((n) => n > 1)))).toBe(true);
  });
});
