import { describe, it, expect } from "vitest";
import { contentDisposition } from "@/lib/exports/respond";

describe("contentDisposition", () => {
  it("survives the punctuation a real contract filename carries", () => {
    const name = "Harborview Grand — NACE Annual Meeting-redline.docx";
    const header = contentDisposition(name);

    // The header is latin-1. Setting one with a raw em dash throws before any
    // bytes reach the associate, so the check is that this one can be set at all.
    expect(() => new Response("x", { headers: { "Content-Disposition": header } })).not.toThrow();

    expect(header).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(header)![1])).toBe(name);
  });

  it("leaves a plain ASCII name alone", () => {
    expect(contentDisposition("marked-up-abc12345.pdf")).toContain('filename="marked-up-abc12345.pdf"');
  });

  it("drops quotes that would end the filename early", () => {
    const header = contentDisposition('we"ird.pdf');
    expect(header).toContain('filename="weird.pdf"');
  });
});
