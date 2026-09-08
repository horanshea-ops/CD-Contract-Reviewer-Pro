import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { generateRedline } from "@/lib/redline-engine";
import type { RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";
import { buildDocx, para, run } from "../helpers/docx-package";

/**
 * The engine end to end (MASTER_PLAN.md §1.5).
 *
 * Every case here goes through §1.6's oracle rather than being eyeballed. The
 * oracle rejects our changes and checks the result is exactly the contract that
 * arrived, so "it looks right" is never the standard.
 */

const AUTHOR = "Jane Associate";

function finding(over: Partial<RevisionFinding> = {}): RevisionFinding {
  return {
    id: "finding-1",
    clause_type: "attrition",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    location_section: null,
    ...over,
  };
}

async function redline(bytes: Uint8Array, findings: RevisionFinding[]) {
  const originalBytes = bytes;
  const result = await generateRedline({ originalDocxBytes: originalBytes, findings, author: AUTHOR });
  const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });
  const xml = await (await JSZip.loadAsync(result.docxBytes)).file("word/document.xml")!.async("string");
  return { result, report, xml };
}

const CLAUSE = "Group shall be liable for eighty percent (80%) of the group rate.";
const SWAP = finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" });

describe("a straightforward replacement", () => {
  it("strikes the old wording and inserts the new one", async () => {
    const { result, report, xml } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);

    expect(result.appliedCount).toBe(1);
    expect(result.unapplied).toEqual([]);
    expect(xml).toContain("<w:delText xml:space=\"preserve\">eighty percent (80%)</w:delText>");
    expect(xml).toContain("seventy percent (70%)");
    expect(report.outcome).toBe("clean");
  });

  it("attributes the change to the associate, not the tool", async () => {
    const { xml } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);
    expect(xml).toContain(`w:author="${AUTHOR}"`);
    expect(xml).not.toMatch(/w:author="[^"]*(Contract Reviewer|CD Tool)/);
  });

  it("does not litter the file with repeated namespace declarations", async () => {
    // Elements created on a detached node serialise with their own xmlns. In
    // the tree they must not, or every edit bloats the file and Word sees a
    // shape it never writes itself.
    const { xml } = await redline(await buildDocx(para(run(CLAUSE))), [SWAP]);
    expect(xml.match(/xmlns:w=/g)?.length ?? 0).toBe(1);
  });
});

describe("cases the old engine refused", () => {
  it("strikes wording the counterparty inserted, nesting inside their change", async () => {
    // §1.5.7, the case most likely to produce a corrupt file. The deletion has
    // to sit inside their w:ins, which is what Word writes.
    const theirs =
      run("Damages are ") +
      `<w:ins w:id="500" w:author="Dana Reyes" w:date="2026-02-14T10:30:00Z">${run("ninety percent (90%)")}</w:ins>` +
      run(" of room revenue.");
    const { result, report, xml } = await redline(
      await buildDocx(para(theirs)),
      [finding({ quoted_text: "ninety percent (90%)", language: "fifty percent (50%)" })]
    );

    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    // Our deletion inside their insertion, not alongside it.
    expect(xml).toMatch(/<w:ins[^>]*Dana Reyes[^>]*>\s*<w:del[^>]*Jane Associate/);
  });

  it("marks up wording that spans a tab", async () => {
    const body = para(run("Deposit schedule") + `<w:r><w:tab/></w:r>` + run("fifty percent (50%) on signing"));
    const { result, report, xml } = await redline(
      await buildDocx(body),
      [finding({ quoted_text: "schedule \t fifty percent (50%)", language: "schedule: twenty-five percent (25%)" })]
    );

    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
    // The tab went into the deletion rather than being destroyed.
    expect(xml).toContain("<w:tab/>");
  });

  it("marks up a change inside a single table cell", async () => {
    const bytes = await buildDocx(
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(run("180 to 91"))}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(run("fifty percent (50%)"))}</w:tc></w:tr></w:tbl>`
    );
    const { result, report } = await redline(bytes, [
      finding({ quoted_text: "fifty percent (50%)", language: "twenty-five percent (25%)" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(report.outcome).toBe("clean");
  });
});

describe("what it still refuses, and says so", () => {
  it("refuses a quote that appears in several clauses with nothing to separate them", async () => {
    const bytes = await readFile(path.join("tests", "fixtures", "11-repeated-phrases.docx"));
    const { result } = await redline(new Uint8Array(bytes), [SWAP]);

    expect(result.appliedCount).toBe(0);
    expect(result.unapplied[0].reason).toBe("not_located");
  });

  it("refuses a second finding overlapping wording already marked up", async () => {
    const { result } = await redline(await buildDocx(para(run(CLAUSE))), [
      SWAP,
      finding({ id: "finding-2", quoted_text: "for eighty percent (80%) of", language: "for seventy percent (70%) of" }),
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.unapplied).toHaveLength(1);
    expect(result.unapplied[0].reason).toBe("overlaps_another_change");
  });

  it("records how each finding resolved, for the weekly review", async () => {
    const { result } = await redline(await buildDocx(para(run(CLAUSE))), [
      SWAP,
      finding({ id: "finding-2", is_missing_clause: true, language: "Resale credit language." }),
    ]);

    expect(result.resolutions).toEqual([
      { findingId: "finding-1", spanResolution: "exact", applicability: "applicable", detail: "Editable in place." },
      {
        findingId: "finding-2",
        spanResolution: "unresolved",
        applicability: "applicable",
        detail: "The clause is not in the contract.",
      },
    ]);
  });
});

describe("the whole fixture corpus", () => {
  it("never produces a document the oracle rejects", async () => {
    const quotes: Record<string, string> = {
      "01-clean-simple.docx": "eighty percent (80%)",
      "02-heavy-tables.docx": "50%",
      "03-tracked-one-author.docx": "night-by-night",
      "04-tracked-two-authors.docx": "one hundred percent (100%)",
      "05-move-from-to.docx": "indemnify Hotel against all claims",
      "07-numbering-crossref.docx": "seventy percent (70%)",
      "09-tracked-in-tables.docx": "seventy-five percent (75%)",
      "10-word-run-splitting.docx": "eighty percent (80%)",
      "12-tabs-breaks-symbols.docx": "Balance",
      "13-nested-merged-tables.docx": "Tier A fifty percent (50%)",
      "14-revision-id-collisions.docx": "eighty percent (80%)",
      "15-links-footnotes-comments.docx": "thirty-five dollars ($35.00) per room per night",
    };

    for (const [file, quote] of Object.entries(quotes)) {
      const bytes = new Uint8Array(await readFile(path.join("tests", "fixtures", file)));
      const { report } = await redline(bytes, [finding({ quoted_text: quote, language: "REPLACEMENT LANGUAGE" })]);
      expect(report.checks.filter((c) => !c.passed), file).toEqual([]);
    }
  });
});
