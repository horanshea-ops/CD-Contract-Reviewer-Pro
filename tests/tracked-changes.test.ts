import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { generateTrackedChangesDocx } from "@/lib/tracked-changes-docx";
import type { MemoFinding } from "@/lib/export-memo";

/**
 * Regression tests for the tracked-changes engine that is live in the app
 * today (app/api/analyses/[id]/export-redline-docx/route.ts).
 *
 * Each of these corresponds to a defect found by running the engine over the
 * fixture corpus — see docs/live-engine-validation.md. They matter more than
 * usual because the output is a file an associate emails to a hotel: a failure
 * here is a corrupt or misleading contract, not a broken screen.
 */

const DIR = path.join("tests", "fixtures");
const AUTHOR = "Jane Associate";

function finding(over: Partial<MemoFinding> = {}): MemoFinding {
  return {
    clause_type: "attrition",
    severity: "high",
    is_missing_clause: false,
    quoted_text: null,
    language: "",
    finding_text: "Unfavourable to the client.",
    cd_standard: "CD position.",
    ...over,
  };
}

async function redline(file: string, findings: MemoFinding[]) {
  const original = await readFile(path.join(DIR, file));
  const out = await generateTrackedChangesDocx({ originalDocxBytes: original, findings, author: AUTHOR });
  const inZip = await JSZip.loadAsync(original);
  const outZip = await JSZip.loadAsync(out.docxBytes);
  return {
    result: out,
    beforeXml: await inZip.file("word/document.xml")!.async("string"),
    afterXml: await outZip.file("word/document.xml")!.async("string"),
    beforeEntries: Object.keys(inZip.files),
    afterEntries: Object.keys(outZip.files),
  };
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** How the contract reads now: plain runs and insertions; deletions excluded. */
function acceptedText(xml: string) {
  const noDel = xml.replace(/<w:del\b[\s\S]*?<\/w:del>/g, "");
  return collapse([...noDel.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));
}

/**
 * How it reads after rejecting only OUR revisions. Scoping to the author
 * matters: rejecting every revision would also unwind the counterparty's,
 * winding the document back past what they actually sent us.
 */
function rejectOurs(xml: string) {
  const a = AUTHOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noIns = xml.replace(new RegExp(`<w:ins\\b[^>]*w:author="${a}"[^>]*>[\\s\\S]*?<\\/w:ins>`, "g"), "");
  const restored = noIns.replace(
    new RegExp(`<w:del\\b[^>]*w:author="${a}"[^>]*>([\\s\\S]*?)<\\/w:del>`, "g"),
    (_m, inner: string) => inner.replace(/<w:delText/g, "<w:t").replace(/<\/w:delText>/g, "</w:t>")
  );
  return acceptedText(restored);
}

function parse(xml: string) {
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level: string, msg: unknown) => { if (level !== "warning") errors.push(String(msg)); },
  }).parseFromString(xml, "text/xml");
  return { doc, errors };
}

describe("tracked-changes engine — structural safety", () => {
  it("refuses a span crossing a table cell boundary instead of merging cells", async () => {
    // The splice replaces everything between the first and last run. Reaching
    // into the next cell swallows the </w:p></w:tc><w:tc> between them, so the
    // cells merge and the row ends up with fewer cells than the grid declares.
    const { result, beforeXml, afterXml } = await redline("13-nested-merged-tables.docx", [
      finding({
        clause_type: "cancellation",
        quoted_text: "Tier A fifty percent (50%)",
        language: "Tier A twenty-five percent (25%)",
      }),
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.unapplied).toHaveLength(1);

    const before = parse(beforeXml).doc;
    const after = parse(afterXml).doc;
    for (const tag of ["w:tbl", "w:tr", "w:tc"]) {
      expect(after.getElementsByTagName(tag).length, `${tag} count`).toBe(
        before.getElementsByTagName(tag).length
      );
    }
  });

  it("edits the correct occurrence when a phrase repeats", async () => {
    const { afterXml } = await redline("11-repeated-phrases.docx", [
      finding({
        clause_type: "cancellation",
        quoted_text: "Cancellation damages are eighty percent (80%) of anticipated room revenue.",
        language: "Cancellation damages are fifty percent (50%) of anticipated room revenue.",
      }),
    ]);
    const struck = [...afterXml.matchAll(/<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/g)]
      .map((m) => m[1])
      .join(" ");
    // "eighty percent (80%)" appears in four clauses; the attrition one is first.
    expect(struck).toContain("Cancellation damages");
    expect(struck).not.toContain("Group shall be liable");
  });

  it("locates a phrase Word split across runs mid-word", async () => {
    // "eighty percent (80%)" exists in no single run of this fixture.
    const { result, afterXml } = await redline("10-word-run-splitting.docx", [
      finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" }),
    ]);
    expect(result.appliedCount).toBe(1);
    expect(acceptedText(afterXml)).toContain("seventy percent (70%)");
  });
});

describe("tracked-changes engine — nothing survives a reject", () => {
  it("leaves no tooling language behind when every change is rejected", async () => {
    // The appendix heading used to be plain text, so "COULD NOT BE LOCATED FOR
    // MARKUP..." stayed in the contract permanently after a reject-all.
    const { beforeXml, afterXml } = await redline("06-header-footer-terms.docx", [
      finding({ clause_type: "cutoff_date", quoted_text: "thirty (30) days", language: "sixty (60) days" }),
    ]);
    expect(afterXml).toContain("COULD NOT BE LOCATED");
    const rejected = rejectOurs(afterXml);
    expect(rejected).not.toContain("COULD NOT BE LOCATED");
    expect(rejected).not.toContain("REQUESTED ADDITIONS");
    expect(rejected).toBe(acceptedText(beforeXml));
  });

  it("marks the paragraph mark of an inserted paragraph, not just its runs", async () => {
    const { afterXml } = await redline("01-clean-simple.docx", [
      finding({ is_missing_clause: true, clause_type: "resale_mitigation_duty", language: "Hotel shall resell." }),
    ]);
    // Without the pPr/rPr marker, rejecting removes the text but leaves an
    // empty paragraph behind in the counterparty's document.
    expect(afterXml).toMatch(/<w:pPr><w:rPr><w:ins\b[^>]*\/><\/w:rPr><\/w:pPr>/);
  });
});

describe("tracked-changes engine — output validity", () => {
  const cases: Array<[string, MemoFinding[]]> = [
    ["01-clean-simple.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]],
    ["03-tracked-one-author.docx", [finding({ quoted_text: "night-by-night", language: "cumulative" })]],
    ["09-tracked-in-tables.docx", [finding({ quoted_text: "seventy-five percent (75%)", language: "sixty percent (60%)" })]],
    ["14-revision-id-collisions.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]],
    ["15-links-footnotes-comments.docx", [finding({ quoted_text: "eighty percent (80%)", language: "seventy percent (70%)" })]],
  ];

  it.each(cases)("%s produces valid, rejectable output", async (file, findings) => {
    const { beforeXml, afterXml, beforeEntries, afterEntries } = await redline(file, findings);

    expect(parse(afterXml).errors).toEqual([]);
    expect(beforeEntries.filter((e) => !afterEntries.includes(e))).toEqual([]);

    // Word rejects duplicate revision ids, and ids must fit a signed 32-bit int.
    const ids = [...afterXml.matchAll(/<w:(?:ins|del)\b[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size, "duplicate revision ids").toBe(ids.length);
    expect(ids.filter((v) => Number(v) > 2147483647)).toEqual([]);

    // A w:del must carry delText only — a plain w:t inside one is invalid.
    expect(/<w:del\b[^>]*>(?:(?!<\/w:del>)[\s\S])*?<w:t[ >]/.test(afterXml)).toBe(false);

    // The oracle: rejecting our changes returns exactly what the hotel sent.
    expect(rejectOurs(afterXml)).toBe(acceptedText(beforeXml));
  });
});
