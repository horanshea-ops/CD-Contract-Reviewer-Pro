import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildPreview, type PreviewBlock, type PreviewRun } from "@/lib/docx-preview";
import { tableGrids } from "@/lib/docx/table-grid";
import { generateRedline } from "@/lib/redline-engine";
import { checkRenderedPdf, renderStructuredPdf, type StructuredPdfMode } from "@/lib/structured-pdf";
import { FIXTURE_AUTHOR, FIXTURE_CORPUS, readFixture } from "./helpers/fixture-corpus";

/**
 * The PDF drawn from a tracked-changes Word file (lib/structured-pdf.ts).
 *
 * Every fixture is redlined by the engine, then drawn in both modes. The
 * drawing must read back exactly as drawn, stay inside the page, and hold
 * exactly the text the mode calls for: in markup, everything except deletions
 * the property already made; in clean, nothing that was deleted by anyone.
 */

const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
const removes = (r: PreviewRun) => r.revision?.kind === "del" || r.revision?.kind === "moveFrom";

/** The text a mode should show, in document order, list markers included. */
function expectedText(blocks: PreviewBlock[], mode: StructuredPdfMode, own: Set<string>): string {
  const keep = (r: PreviewRun) => !removes(r) || (mode === "markup" && own.has(r.revision!.id));
  let out = "";
  const visit = (list: PreviewBlock[]) => {
    for (const b of list) {
      if (b.kind === "table") {
        for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks);
        continue;
      }
      const text = b.runs.filter(keep).map((r) => r.text).join("");
      if (!alnum(text)) continue;
      if (b.kind === "list-item") out += b.marker;
      out += text;
    }
  };
  visit(blocks);
  return alnum(out);
}

async function redlined(index: number) {
  const { file, findings } = FIXTURE_CORPUS[index];
  const result = await generateRedline({
    originalDocxBytes: new Uint8Array(await readFixture(file)),
    findings,
    author: FIXTURE_AUTHOR,
  });
  const parts = buildPreview(await extractDocx(result.docxBytes));
  const body = parts.find((p) => p.part === "document")!;
  return { file, findings, result, blocks: body.blocks, own: new Set(result.ownRevisionIds) };
}

describe("structured PDF over the fixture corpus", () => {
  it.each(FIXTURE_CORPUS.map((c, i) => [i, c.file] as const))("%i %s draws and reads back in both modes", async (index) => {
    const { result, blocks, own } = await redlined(index);
    const grids = await tableGrids(result.docxBytes);

    for (const mode of ["markup", "clean"] as const) {
      const pdf = await renderStructuredPdf({ blocks, mode, ownRevisionIds: own, tableGrids: grids });
      expect(pdf.overflow).toEqual([]);
      expect(await checkRenderedPdf(pdf)).toEqual([]);
      expect(alnum(pdf.drawn.join(""))).toBe(expectedText(blocks, mode, own));
    }
  });
});

describe("what each mode shows", () => {
  it("shows the old and new wording in markup, and only the new in clean", async () => {
    const { blocks, own } = await redlined(0);
    const markup = await renderStructuredPdf({ blocks, mode: "markup", ownRevisionIds: own });
    const clean = await renderStructuredPdf({ blocks, mode: "clean", ownRevisionIds: own });

    const m = alnum(markup.drawn.join(""));
    const c = alnum(clean.drawn.join(""));
    expect(m).toContain("eighty");
    expect(m).toContain("seventy");
    expect(c).toContain("seventypercent70");
    expect(c).not.toContain("eightypercent80");
  });

  it("marks only this export's own changes, leaving the property's as they read", async () => {
    const index = FIXTURE_CORPUS.findIndex((c) => c.file === "04-tracked-two-authors.docx");
    const { blocks } = await redlined(index);
    const theirs = blocks.flatMap((b) => ("runs" in b ? b.runs : [])).filter((r) => r.revision);
    expect(theirs.length).toBeGreaterThan(0);

    // With no revisions counted as ours, markup and clean draw the same text.
    const none = new Set<string>();
    const markup = await renderStructuredPdf({ blocks, mode: "markup", ownRevisionIds: none });
    const clean = await renderStructuredPdf({ blocks, mode: "clean", ownRevisionIds: none });
    expect(markup.drawn.join("")).toBe(clean.drawn.join(""));
  });

  it("lists changes that could not be placed after the contract", async () => {
    const { blocks, own } = await redlined(0);
    const pdf = await renderStructuredPdf({
      blocks,
      mode: "clean",
      ownRevisionIds: own,
      extraChanges: [{ label: "Rate parity", language: "Group rates will be no higher than any public rate." }],
    });
    const text = pdf.drawn.join(" ");
    expect(text).toContain("Further Proposed Changes");
    expect(text).toContain("Rate parity");
    expect(await checkRenderedPdf(pdf)).toEqual([]);
  });
});

describe("drawing", () => {
  const para = (text: string): PreviewBlock => ({
    kind: "paragraph",
    runs: [{ text, revision: null, range: null, kind: "text" }],
  });

  it("flows a long document onto more pages and numbers them", async () => {
    const blocks = Array.from({ length: 120 }, (_, i) => para(`Clause ${i}. ${"The Hotel will hold the rooms. ".repeat(8)}`));
    const pdf = await renderStructuredPdf({ blocks, mode: "clean", ownRevisionIds: new Set() });
    expect(pdf.pageCount).toBeGreaterThan(3);
    expect(pdf.overflow).toEqual([]);
    expect(await checkRenderedPdf(pdf)).toEqual([]);
  });

  it("breaks a word wider than a narrow table cell instead of drawing past it", async () => {
    const cell = (text: string) => ({ blocks: [para(text)] });
    const table: PreviewBlock = {
      kind: "table",
      rows: [{ cells: [cell("A"), cell("Supercalifragilisticexpialidocious"), ...Array.from({ length: 8 }, () => cell("x"))] }],
    };
    const pdf = await renderStructuredPdf({
      blocks: [table],
      mode: "clean",
      ownRevisionIds: new Set(),
      tableGrids: [{ columns: Array(10).fill(700), rows: [Array(10).fill(1)] }],
    });
    expect(pdf.drawn.length).toBeGreaterThan(10);
    expect(await checkRenderedPdf(pdf)).toEqual([]);
  });

  it("draws a euro sign and a tick without dropping the text around them", async () => {
    const pdf = await renderStructuredPdf({ blocks: [para("€35.00 per guard ✔ included")], mode: "clean", ownRevisionIds: new Set() });
    expect(pdf.drawn.join("")).toContain("€35.00");
    expect(pdf.drawn).toContain("✔");
    expect(await checkRenderedPdf(pdf)).toEqual([]);
  });
});
