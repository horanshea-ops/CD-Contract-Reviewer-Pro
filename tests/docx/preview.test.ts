import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractDocx } from "@/lib/docx";
import { buildPartPreview, buildPreview, resolveHighlight, type PreviewBlock, type PreviewRun } from "@/lib/docx-preview";

const DIR = path.join("tests", "fixtures");
const load = async (f: string) => extractDocx(await readFile(path.join(DIR, f)));
const allFixtures = async () => (await readdir(DIR)).filter((f) => f.endsWith(".docx")).sort();

/** Every run in document order, including inside table cells (recursively). */
function allRuns(blocks: PreviewBlock[]): PreviewRun[] {
  const runs: PreviewRun[] = [];
  for (const b of blocks) {
    if (b.kind === "table") {
      for (const row of b.rows) for (const cell of row.cells) runs.push(...allRuns(cell.blocks));
    } else {
      runs.push(...b.runs);
    }
  }
  return runs;
}

function allBlocksDeep(blocks: PreviewBlock[]): PreviewBlock[] {
  const out: PreviewBlock[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.kind === "table") {
      for (const row of b.rows) for (const cell of row.cells) out.push(...allBlocksDeep(cell.blocks));
    }
  }
  return out;
}

describe("docx-preview — offset round trip", () => {
  it("every accepted run's range slices back to its own text, for every fixture", async () => {
    for (const f of await allFixtures()) {
      const { parts } = await load(f);
      for (const part of parts) {
        const blocks = buildPartPreview(part);
        const runs = allRuns(blocks);
        let prevEnd: number | null = null;
        for (const run of runs) {
          if (!run.range) continue; // del/moveFrom — not in the accepted view
          expect(part.text.slice(run.range.start, run.range.end), `${f} / ${part.part}`).toBe(run.text);
          if (prevEnd != null) {
            expect(run.range.start, `${f} / ${part.part} monotonic`).toBeGreaterThanOrEqual(prevEnd);
          }
          prevEnd = run.range.end;
        }
      }
    }
  });
});

describe("docx-preview — structure (§1.4.5, mirrored for the preview)", () => {
  it("keeps the cancellation schedule as an actual table", async () => {
    const { document } = await load("02-heavy-tables.docx");
    const blocks = buildPartPreview(document);
    const tables = allBlocksDeep(blocks).filter((b) => b.kind === "table");
    expect(tables.length).toBe(2);

    const schedule = tables[0];
    if (schedule.kind !== "table") throw new Error("unreachable");
    // Separator row must not appear as a data row.
    expect(schedule.rows.every((r) => !r.cells.some((c) => allRuns(c.blocks).some((run) => run.text.includes("---"))))).toBe(true);
    expect(schedule.rows.length).toBeGreaterThanOrEqual(6);

    const cellText = (row: (typeof schedule.rows)[number]) =>
      row.cells.map((c) => allRuns(c.blocks).map((r) => r.text).join("")).join(" | ");
    expect(schedule.rows.map(cellText).join("\n")).toContain("Days Prior to Arrival");
    expect(schedule.rows.map(cellText).join("\n")).toContain("365 or more");
  });

  it("marks headings with their level", async () => {
    const { document } = await load("01-clean-simple.docx");
    const blocks = buildPartPreview(document);
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) if (h.kind === "heading") expect(h.level).toBeGreaterThanOrEqual(1);
    const roomBlock = headings.find(
      (h) => h.kind === "heading" && h.runs.map((r) => r.text).join("").includes("Room Block")
    );
    expect(roomBlock).toBeTruthy();
  });

  it("emits list items with real resolved numbering, not raw markers", async () => {
    const { document } = await load("07-numbering-crossref.docx");
    const blocks = buildPartPreview(document);
    const items = allBlocksDeep(blocks).filter((b) => b.kind === "list-item");
    expect(items.length).toBeGreaterThan(0);
    const markers = items.map((b) => (b.kind === "list-item" ? b.marker : "")).join(" ");
    expect(markers).toContain("1.a");
  });

  it("reads header and footer parts separately", async () => {
    const extracted = await load("06-header-footer-terms.docx");
    const preview = buildPreview(extracted);
    expect(preview.map((p) => p.part)).toEqual(["document", "header1", "footer1"]);
    const header = preview.find((p) => p.part === "header1")!;
    expect(allRuns(header.blocks).map((r) => r.text).join("")).toContain("thirty (30) days prior to arrival");
  });

  it("recurses into a table nested inside a table cell", async () => {
    const { document } = await load("13-nested-merged-tables.docx");
    const blocks = buildPartPreview(document);
    const topTables = allBlocksDeep(blocks).filter((b) => b.kind === "table");
    const nested = topTables.some((t) =>
      t.kind === "table" && t.rows.some((r) => r.cells.some((c) => c.blocks.some((b) => b.kind === "table")))
    );
    expect(nested).toBe(true);
  });
});

describe("docx-preview — existing revisions rendered inline", () => {
  it("gives a deletion a null range and an insertion a real one", async () => {
    const { document } = await load("03-tracked-one-author.docx");
    const runs = allRuns(buildPartPreview(document));
    const del = runs.find((r) => r.revision?.kind === "del");
    const ins = runs.find((r) => r.revision?.kind === "ins");
    expect(del).toBeTruthy();
    expect(del?.range).toBeNull();
    expect(ins).toBeTruthy();
    expect(ins?.range).not.toBeNull();
  });

  it("keeps both authors distinguishable across runs", async () => {
    const { document } = await load("04-tracked-two-authors.docx");
    const runs = allRuns(buildPartPreview(document));
    const authors = new Set(runs.map((r) => r.revision?.author).filter(Boolean));
    expect(authors).toContain("Dana Reyes");
    expect(authors).toContain("Morgan Ellis");
  });

  it("marks a move as moveFrom (excluded) and moveTo (included)", async () => {
    const { document } = await load("05-move-from-to.docx");
    const runs = allRuns(buildPartPreview(document));
    const from = runs.find((r) => r.revision?.kind === "moveFrom");
    const to = runs.find((r) => r.revision?.kind === "moveTo");
    expect(from?.range).toBeNull();
    expect(to?.range).not.toBeNull();
  });

  it("preserves revision info on runs inside a table cell", async () => {
    const { document } = await load("09-tracked-in-tables.docx");
    const blocks = buildPartPreview(document);
    const tables = allBlocksDeep(blocks).filter((b) => b.kind === "table");
    const cellRuns = tables.flatMap((t) =>
      t.kind === "table" ? t.rows.flatMap((r) => r.cells.flatMap((c) => allRuns(c.blocks))) : []
    );
    expect(cellRuns.some((r) => r.revision !== null)).toBe(true);
  });
});

describe("docx-preview — doesn't crash on the harder fixtures", () => {
  it("handles split runs, reassembling contiguous ranges", async () => {
    const { document } = await load("10-word-run-splitting.docx");
    const runs = allRuns(buildPartPreview(document));
    const full = document.text;
    const i = full.indexOf("eighty percent (80%)");
    const covering = runs.filter((r) => r.range && r.range.start < i + 21 && r.range.end > i);
    expect(covering.length).toBeGreaterThan(0);
    expect(covering.map((r) => r.text).join("")).toContain("eighty percent (80%)");
  });

  it("renders content-control and field text as ordinary content", async () => {
    const { document } = await load("08-content-controls-fields.docx");
    const text = allRuns(buildPartPreview(document)).map((r) => r.text).join("");
    expect(text).toContain("Acme Association");
  });

  it("does not throw on hyperlinks, footnotes, and comments", async () => {
    const extracted = await load("15-links-footnotes-comments.docx");
    expect(() => buildPreview(extracted)).not.toThrow();
    const text = allRuns(buildPartPreview(extracted.document)).map((r) => r.text).join("");
    expect(text).toContain("the hotel fee schedule");
  });

  it("parses every fixture without throwing", async () => {
    for (const f of await allFixtures()) {
      const extracted = await load(f);
      expect(() => buildPreview(extracted), f).not.toThrow();
    }
  });
});

describe("resolveHighlight", () => {
  it("finds an exact match", async () => {
    const extracted = await load("01-clean-simple.docx");
    const needle = "eighty percent (80%)";
    const text = extracted.document.text;
    expect(text).toContain(needle);
    const match = resolveHighlight(buildPreview(extracted), needle);
    expect(match).toEqual({ part: "document", start: text.indexOf(needle), end: text.indexOf(needle) + needle.length, tier: "exact" });
  });

  it("falls back to a normalized match when whitespace/case differ", async () => {
    const extracted = await load("01-clean-simple.docx");
    const text = extracted.document.text;
    const idx = text.indexOf("eighty percent (80%)");
    const perturbed = "EIGHTY   percent (80%)";
    const match = resolveHighlight(buildPreview(extracted), perturbed);
    expect(match?.tier).toBe("normalized");
    expect(text.slice(match!.start, match!.end).toLowerCase().replace(/\s+/g, " ")).toBe("eighty percent (80%)");
    expect(match!.start).toBe(idx);
  });

  it("returns null when nothing matches", async () => {
    const extracted = await load("01-clean-simple.docx");
    const match = resolveHighlight(buildPreview(extracted), "this text is nowhere in the contract");
    expect(match).toBeNull();
  });

  it("resolves a match that only exists in the header", async () => {
    const extracted = await load("06-header-footer-terms.docx");
    const match = resolveHighlight(buildPreview(extracted), "thirty (30) days prior to arrival");
    expect(match?.part).toBe("header1");
  });

  it("finds a table quote flattened the way a model actually produces one — cells joined by '|', the synthetic separator row omitted", async () => {
    const extracted = await load("02-heavy-tables.docx");
    const flattenedQuote = "Days Prior to Arrival | Damages (% of Room Revenue) | 365 or more | 25%";
    // The literal text has a "| --- | --- |" separator row between the header
    // and first data row, which the model's flattened quote never includes —
    // tiers 1 and 2 (raw-text based) cannot bridge that, only tier 3 can.
    expect(extracted.document.text).not.toContain(flattenedQuote);

    const match = resolveHighlight(buildPreview(extracted), flattenedQuote);
    expect(match?.tier).toBe("flattened");
    expect(match?.part).toBe("document");
    // The resolved range must land on real content: "365 or more" and "25%"
    // both actually appear inside the matched span of the real text.
    const covered = extracted.document.text.slice(match!.start, match!.end);
    expect(covered).toContain("365 or more");
    expect(covered).toContain("25%");
  });
});
