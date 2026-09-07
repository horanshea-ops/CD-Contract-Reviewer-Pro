import { describe, expect, it } from "vitest";
import { detectSourceFormat, SUPPORTED_MIME_TYPES } from "@/lib/document-conversion";

/**
 * `detectSourceFormat` is the gate that decides which pipeline an upload enters.
 * MASTER_PLAN.md §1.4.9 replaces this MIME-type-only decision with a real
 * extraction health check, so these tests exist to make that change legible:
 * whatever §1.4.9 does differently should show up here as a deliberate diff,
 * not as silent drift.
 */
describe("detectSourceFormat", () => {
  it("recognises each supported format", () => {
    expect(detectSourceFormat(SUPPORTED_MIME_TYPES.pdf)).toBe("pdf");
    expect(detectSourceFormat(SUPPORTED_MIME_TYPES.docx)).toBe("docx");
    expect(detectSourceFormat(SUPPORTED_MIME_TYPES.doc)).toBe("doc");
  });

  it("rejects unsupported types rather than guessing", () => {
    expect(detectSourceFormat("text/plain")).toBeNull();
    expect(detectSourceFormat("application/rtf")).toBeNull();
    expect(detectSourceFormat("")).toBeNull();
  });

  it("does not fall back to a format on a near-miss MIME type", () => {
    // A .docx sent with the legacy .doc MIME type must not be routed as DOCX:
    // the revision engine would then try to edit OOXML that isn't there.
    // Trailing parameters and casing are likewise not currently tolerated.
    expect(detectSourceFormat(`${SUPPORTED_MIME_TYPES.docx}; charset=utf-8`)).toBeNull();
    expect(detectSourceFormat(SUPPORTED_MIME_TYPES.docx.toUpperCase())).toBeNull();
  });
});
