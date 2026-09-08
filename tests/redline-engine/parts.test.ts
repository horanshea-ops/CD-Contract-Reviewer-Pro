import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { generateRedline, type RevisionFinding } from "@/lib/redline-engine";
import { validateRedline } from "@/lib/redline-validation";

/**
 * Redlining a header or footer.
 *
 * docs/live-engine-validation.md records this as a known gap: the old engine
 * only ever touched word/document.xml, so a cutoff date or a cancellation
 * notice address living in a header was analysed and then silently left alone.
 * The source map has always been per-part, so once the engine works on the tree
 * it works on any part — this is the test that says so rather than assuming it.
 */

const AUTHOR = "Jane Associate";

const finding = (over: Partial<RevisionFinding> = {}): RevisionFinding => ({
  id: "finding-1",
  clause_type: "cutoff_date",
  severity: "high",
  is_missing_clause: false,
  quoted_text: null,
  language: "",
  finding_text: "Cutoff too early.",
  cd_standard: "CD position.",
  location_section: null,
  ...over,
});

describe("terms that live in a header", () => {
  it("marks them up, and the oracle accepts the result", async () => {
    const originalBytes = new Uint8Array(
      await readFile(path.join("tests", "fixtures", "06-header-footer-terms.docx"))
    );
    const result = await generateRedline({
      originalDocxBytes: originalBytes,
      findings: [finding({ quoted_text: "thirty (30) days", language: "sixty (60) days" })],
      author: AUTHOR,
    });
    const report = await validateRedline({ originalBytes, engineResult: result, author: AUTHOR });

    expect(result.appliedCount).toBe(1);
    expect(report.checks.filter((c) => !c.passed)).toEqual([]);
    expect(report.outcome).toBe("clean");
  });

  it("writes the header part and leaves the body alone", async () => {
    const originalBytes = new Uint8Array(
      await readFile(path.join("tests", "fixtures", "06-header-footer-terms.docx"))
    );
    const before = await JSZip.loadAsync(originalBytes);
    const bodyBefore = await before.file("word/document.xml")!.async("string");

    const result = await generateRedline({
      originalDocxBytes: originalBytes,
      findings: [finding({ quoted_text: "thirty (30) days", language: "sixty (60) days" })],
      author: AUTHOR,
    });

    const after = await JSZip.loadAsync(result.docxBytes);
    const bodyAfter = await after.file("word/document.xml")!.async("string");
    const headers = Object.keys(after.files).filter((f) => /header\d*\.xml$/.test(f));
    const headerXml = await Promise.all(headers.map((h) => after.file(h)!.async("string")));

    // Only the part that actually changed is rewritten.
    expect(bodyAfter).toBe(bodyBefore);
    expect(headerXml.join("")).toContain("sixty (60) days");
    expect(headerXml.join("")).toContain("<w:delText");
  });
});
