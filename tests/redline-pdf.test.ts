import { describe, expect, it } from "vitest";
import { extractTextItems } from "unpdf";
import { textToPdf } from "@/lib/text-to-pdf";
import { generateMarkupPdf } from "@/lib/redline-pdf";
import type { MemoFinding } from "@/lib/export-memo";

const BODY = "The Hotel shall provide the Group with a cancellation fee equal to eighty percent (80%) of anticipated revenue.";

function finding(overrides: Partial<MemoFinding> = {}): MemoFinding {
  return {
    clause_type: "cancellation",
    severity: "high",
    is_missing_clause: false,
    quoted_text: "eighty percent (80%) of anticipated revenue",
    language: "fifty percent (50%) of anticipated revenue",
    finding_text: "This cancellation fee is well above market and should be negotiated down.",
    cd_standard: "cancellation-fee-cap",
    ...overrides,
  };
}

async function fullText(pdfBytes: Uint8Array): Promise<string> {
  const { items } = await extractTextItems(pdfBytes);
  return items.flat().map((i) => i.str).join(" ");
}

describe("generateMarkupPdf", () => {
  it("inserts a cover page before the original document, listing every change", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [finding()];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text).toContain("Proposed Changes");
    expect(text).toContain("cancellation");
    expect(text).toContain("fifty percent (50%) of anticipated revenue");
    // The cover page precedes the original body text.
    expect(text.indexOf("Proposed Changes")).toBeLessThan(text.indexOf(BODY.slice(0, 20)));
  });

  it("includes a row for a missing-clause finding, noted as a requested addition", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [
      finding({
        clause_type: "indemnification",
        is_missing_clause: true,
        quoted_text: null,
        language: "The Group shall indemnify the Hotel against third-party claims arising from the event.",
      }),
    ];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text).toContain("requested addition");
    expect(text).toContain("indemnify the Hotel");
  });

  it("never carries severity labels or the finding's internal rationale", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [
      finding({ severity: "high", finding_text: "INTERNAL-RATIONALE-MARKER should never appear in output." }),
    ];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text).not.toMatch(/\bHIGH\b|\bMEDIUM\b|\bLOW\b/);
    expect(text).not.toContain("INTERNAL-RATIONALE-MARKER");
    expect(text).not.toContain("Rationale");
  });

  it("never explains why this is a PDF rather than a Word document", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [finding()];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text.toLowerCase()).not.toContain("word");
    expect(text.toLowerCase()).not.toContain("tracked change");
    expect(text.toLowerCase()).not.toContain("safely edited");
  });

  it("notes an unmatched quote without exposing any internal detail", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [finding({ quoted_text: "language that does not appear anywhere in this document" })];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text).toContain("not located in document");
  });

  it("lists each proposed change exactly once — no separate appendix repeating the cover table", async () => {
    const { pdfBytes, lines } = await textToPdf("Sample Contract", BODY);
    const findings = [finding()];

    const markup = await generateMarkupPdf({ pdfBytes, lines, findings });
    const text = await fullText(markup);

    expect(text).not.toContain("Redline Notes");
    const occurrences = text.split("fifty percent (50%) of anticipated revenue").length - 1;
    expect(occurrences).toBe(1);
  });
});
