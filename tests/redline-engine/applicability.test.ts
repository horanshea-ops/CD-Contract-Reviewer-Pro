import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NumberingResolver, loadDocx, walkPart, type WalkResult } from "@/lib/docx";
import { assessApplicability } from "@/lib/redline-engine/applicability";
import { locateQuote } from "@/lib/redline-engine/locate";
import { isLocated } from "@/lib/redline-engine/types";
import { buildDocx, para, run, table } from "../helpers/docx-package";

/**
 * Whether a located span can be edited, and how (MASTER_PLAN.md §1.5.3).
 *
 * The table cases are the ones to watch. Two cells are always two paragraphs,
 * so a gate that checked paragraphs first would reject every cross-cell change
 * as a paragraph problem and the table strategy would never run at all — a
 * silent regression that still passes every other test.
 */

async function walk(bytes: Uint8Array | Buffer): Promise<WalkResult[]> {
  const pkg = await loadDocx(bytes);
  const numbering = new NumberingResolver(pkg.numbering);
  return pkg.textParts.map((p) => walkPart(p, numbering));
}

async function assess(bytes: Uint8Array | Buffer, quote: string) {
  const parts = await walk(bytes);
  const span = locateQuote(parts, quote, null);
  if (!isLocated(span)) throw new Error(`could not locate "${quote}": ${span.reason}`);
  const part = parts.find((p) => p.part === span.part)!;
  return assessApplicability(part, span);
}

const SCHEDULE = [
  ["Days Prior to Arrival", "Damages"],
  ["365 or more", "25%"],
  ["180 to 91", "50%"],
];

describe("ordinary prose", () => {
  it("is editable in place", async () => {
    const bytes = await buildDocx(para(run("Group shall be liable for eighty percent (80%) of the group rate.")));
    const result = await assess(bytes, "eighty percent (80%)");

    expect(result.applicability).toBe("applicable");
    expect(result.strategy).toBe("in_place");
  });

  it("is refused when it runs across a paragraph break", async () => {
    const bytes = await buildDocx(
      para(run("Group shall be liable for unsold rooms.")) + para(run("Cancellation damages are separate."))
    );
    const result = await assess(bytes, "unsold rooms. Cancellation damages");

    expect(result.applicability).toBe("blocked_cross_paragraph");
  });
});

describe("tables", () => {
  it("edits in place when the change sits in one cell", async () => {
    // The common case — "50% should be 40%". A whole-table replacement here
    // would show the property the entire schedule struck through in red.
    const result = await assess(await buildDocx(table(SCHEDULE)), "50%");

    expect(result.applicability).toBe("applicable");
    expect(result.strategy).toBe("in_place");
  });

  it("replaces the whole table when the change spans cells", async () => {
    const result = await assess(await buildDocx(table(SCHEDULE)), "180 to 91 | 50%");

    expect(result.applicability).toBe("applicable");
    expect(result.strategy).toBe("table_replacement");
    expect(result.tableIndex).toBe(0);
  });

  it("refuses a span that leaves the table", async () => {
    const bytes = await buildDocx(table(SCHEDULE) + para(run("Damages are calculated cumulatively.")));
    const result = await assess(bytes, "50% | Damages are calculated");

    expect(result.applicability).toBe("blocked_table");
  });

  it("refuses a span running from one table into a nested one", async () => {
    const nested =
      `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>` +
      `${para(run("Outer cell text"))}` +
      table([["Tier A", "fifty percent (50%)"]]) +
      `${para(run(""))}</w:tc></w:tr></w:tbl>`;
    const result = await assess(await buildDocx(nested), "Outer cell text | Tier A");

    expect(result.applicability).toBe("blocked_table");
  });
});

describe("constructs Word owns", () => {
  it("refuses text inside a content control", async () => {
    const parts = await walk(await readFile(path.join("tests", "fixtures", "08-content-controls-fields.docx")));
    const span = locateQuote(parts, "eighty percent (80%)", null);
    expect(isLocated(span)).toBe(true);
    if (!isLocated(span)) return;

    const result = assessApplicability(parts.find((p) => p.part === span.part)!, span);
    expect(result.applicability).toBe("blocked_content_control");
  });

  it("refuses text produced by a field code", async () => {
    const bytes = await buildDocx(
      para(
        run("As described in ") +
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF _x \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
          run("Section 2.1") +
          `<w:r><w:fldChar w:fldCharType="end"/></w:r>` +
          run(", the parties agree.")
      )
    );
    const result = await assess(bytes, "Section 2.1");

    expect(result.applicability).toBe("blocked_field");
  });
});

describe("what the old engine refused and this does not", () => {
  it("allows a change inside the property's own insertion", async () => {
    // §1.5.7. The deletion nests inside their w:ins rather than being refused.
    const parts = await walk(await readFile(path.join("tests", "fixtures", "03-tracked-one-author.docx")));
    const withIns = parts[0].map.find((e) => "insideIns" in e && e.insideIns);
    expect(withIns, "fixture 03 should contain the counterparty's insertion").toBeTruthy();

    const index = parts[0].map.findIndex((e) => "insideIns" in e && e.insideIns);
    const span = { part: parts[0].part, start: index, end: index + 5, resolution: "exact" as const, similarity: 1 };
    expect(assessApplicability(parts[0], span).applicability).toBe("applicable");
  });

  it("allows a change spanning a tab", async () => {
    const bytes = await buildDocx(
      para(run("Deposit schedule") + `<w:r><w:tab/></w:r>` + run("fifty percent (50%) on signing"))
    );
    const result = await assess(bytes, "Deposit schedule \t fifty percent (50%)");

    expect(result.applicability).toBe("applicable");
    expect(result.strategy).toBe("in_place");
  });
});
