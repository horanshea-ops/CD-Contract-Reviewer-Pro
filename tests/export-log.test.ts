import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OriginalOverwriteError, readRate, recordExport } from "@/lib/export-log";

/**
 * §1.6.7 — never overwrite the stored original, asserted in code rather than by
 * convention. recordExport is the only place an export's storage path is
 * written, so this is where the assertion has to hold.
 */

function fakeAdmin() {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: "export-1" }, error: null }) }) };
      },
    }),
  } as unknown as SupabaseClient;
  return { admin, inserted };
}

const paths = { storage_path: "converted/a.pdf", original_storage_path: "originals/a.docx" };

const base = {
  analysisId: "analysis-1",
  associateId: "associate-1",
  format: "docx" as const,
  outcome: "clean" as const,
  analysisPaths: paths,
};

describe("recordExport", () => {
  it("refuses to write an export over the uploaded original", async () => {
    const { admin, inserted } = fakeAdmin();
    await expect(
      recordExport(admin, { ...base, storagePath: "originals/a.docx" })
    ).rejects.toBeInstanceOf(OriginalOverwriteError);
    expect(inserted).toEqual([]);
  });

  it("refuses to write an export over the analysed document", async () => {
    const { admin, inserted } = fakeAdmin();
    await expect(
      recordExport(admin, { ...base, storagePath: "converted/a.pdf" })
    ).rejects.toBeInstanceOf(OriginalOverwriteError);
    expect(inserted).toEqual([]);
  });

  it("writes a row for any other path", async () => {
    const { admin, inserted } = fakeAdmin();
    await recordExport(admin, { ...base, storagePath: "redlines/a-redline.docx" });
    expect(inserted[0].storage_path).toBe("redlines/a-redline.docx");
  });

  it("records the degradation reason and detail so §1.6.5's review has something to read", async () => {
    const { admin, inserted } = fakeAdmin();
    await recordExport(admin, {
      ...base,
      outcome: "partial",
      findingsApplied: 3,
      findingsUnapplied: 1,
      unappliedDetail: [
        { clause_type: "attrition", severity: "high", quoted_text: "80%", reason: "crosses_boundary" },
      ],
    });
    expect(inserted[0]).toMatchObject({
      outcome: "partial",
      findings_applied: 3,
      findings_unapplied: 1,
      storage_path: null,
    });
  });

  it("does not fail an export because the log failed", async () => {
    const admin = {
      from: () => ({
        insert: () => ({
          select: () => ({ maybeSingle: async () => ({ data: null, error: { message: "connection lost" } }) }),
        }),
      }),
    } as unknown as SupabaseClient;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordExport(admin, base)).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("§1.6.6 thresholds", () => {
  it("reads the rate the way the plan does", () => {
    expect(readRate(0.0, 0)).toBe("no data");
    expect(readRate(0.02, 50)).toBe("working");
    expect(readRate(0.05, 50)).toBe("acceptable");
    expect(readRate(0.15, 50)).toBe("acceptable");
    expect(readRate(0.16, 50)).toBe("not working");
  });
});
