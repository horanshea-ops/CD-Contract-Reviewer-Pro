import { describe, expect, it } from "vitest";
import { storageSafeName } from "@/lib/storage-key";

/**
 * Found live: uploading "Harborview Grand — NACE Annual Meeting.docx" failed
 * with a raw "Invalid key" from Supabase Storage, after the negotiation row had
 * already been written. Contract filenames carry em dashes, curly quotes and
 * accents as a matter of course.
 */

describe("making a filename safe to store under", () => {
  it("keeps an already-safe name exactly as it is", () => {
    expect(storageSafeName("Harborview Grand - NACE Annual Meeting.docx")).toBe(
      "Harborview Grand - NACE Annual Meeting.docx"
    );
  });

  it("replaces the punctuation Word and macOS insert", () => {
    expect(storageSafeName("Harborview Grand — NACE Annual Meeting.docx")).toBe(
      "Harborview Grand - NACE Annual Meeting.docx"
    );
    expect(storageSafeName("Hilton ‘27 Rooms Agreement.docx")).toBe("Hilton -27 Rooms Agreement.docx");
  });

  it("folds accents to their plain letters rather than dropping the word", () => {
    expect(storageSafeName("Café Riverside Contrat.docx")).toBe("Cafe Riverside Contrat.docx");
  });

  it("keeps the extension when the stem is entirely unusable", () => {
    expect(storageSafeName("→→→.docx")).toBe("contract.docx");
  });

  it("collapses runs and trims the edges", () => {
    expect(storageSafeName("  Hotel «»— (final)  .docx")).toBe("Hotel - (final).docx");
  });

  it("caps a very long name without losing its extension", () => {
    const long = `${"a".repeat(400)}.docx`;
    const safe = storageSafeName(long);
    expect(safe.endsWith(".docx")).toBe(true);
    expect(safe.length).toBeLessThan(140);
  });

  it("handles a name with no extension at all", () => {
    expect(storageSafeName("contract copy")).toBe("contract copy");
    expect(storageSafeName("——")).toBe("contract");
  });

  it("leaves nothing that would break a storage key", () => {
    const messy = "Ünïcødé — “Quotes”, sl/ashes, 100% & more!.DOCX";
    expect(storageSafeName(messy)).toMatch(/^[A-Za-z0-9 ._\-(),&'+@!]+$/);
    expect(storageSafeName(messy)).not.toMatch(/\//);
  });
});
