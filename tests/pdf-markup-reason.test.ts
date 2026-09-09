import { describe, expect, it } from "vitest";
import { getMarkupReason } from "@/lib/pdf-markup-reason";

describe("getMarkupReason", () => {
  it("gives the fixed legacy-.doc explanation regardless of any intake reason", () => {
    const reason = getMarkupReason({ sourceFormat: "doc", intakeHealthReason: "should be ignored" });
    expect(reason).toContain(".doc");
    expect(reason).not.toContain("should be ignored");
  });

  it("uses the stored intake-health reason for a .docx routed to PDF at intake", () => {
    const reason = getMarkupReason({
      sourceFormat: "docx",
      intakeHealthReason: "This document contains existing tracked changes from more authors than we can safely merge.",
    });
    expect(reason).toBe("This document contains existing tracked changes from more authors than we can safely merge.");
  });

  it("falls back to a plain generic explanation if a .docx has no stored reason", () => {
    const reason = getMarkupReason({ sourceFormat: "docx", intakeHealthReason: null });
    expect(reason.length).toBeGreaterThan(0);
    expect(reason.toLowerCase()).toContain("edit");
  });
});
