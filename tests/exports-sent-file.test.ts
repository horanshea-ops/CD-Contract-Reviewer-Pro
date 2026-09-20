import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storeSentFile } from "@/lib/exports/sent-file";

/**
 * §1.9.4 — keeping the tracked-changes file an associate actually sent.
 *
 * It cannot be rebuilt later. A finding's decision changed after the export
 * would rebuild a document nobody ever saw, and §2.1.1's diff against it would
 * blame the property for our own later edit.
 */

function fakeStorage(result: { error: { message: string } | null } | Error) {
  const uploads: { path: string; contentType: string }[] = [];
  const upload = vi.fn(async (path: string, _bytes: Uint8Array, opts: { contentType: string }) => {
    if (result instanceof Error) throw result;
    uploads.push({ path, contentType: opts.contentType });
    return result;
  });
  const admin = { storage: { from: () => ({ upload }) } } as unknown as SupabaseClient;
  return { admin, uploads, upload };
}

const input = {
  associateId: "associate-1",
  analysisId: "analysis-1",
  filename: "Harborview Grand — NACE Annual Meeting-redline.docx",
  bytes: new Uint8Array([1, 2, 3]),
  contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

describe("storeSentFile", () => {
  it("files it under the analysis, apart from the uploaded original", async () => {
    const { admin, uploads } = fakeStorage({ error: null });
    const path = await storeSentFile(admin, input);

    expect(path).toMatch(/^associate-1\/analysis-1\/sent\//);
    expect(uploads[0].path).toBe(path);
    expect(uploads[0].contentType).toBe(input.contentType);
  });

  it("makes a real contract filename safe to use as a storage key", async () => {
    const { admin } = fakeStorage({ error: null });
    const path = await storeSentFile(admin, input);
    expect(path).not.toContain("—");
    expect(path).toContain("NACE");
  });

  it("gives two exports of one analysis two files, rather than overwriting the first", async () => {
    vi.useFakeTimers();
    try {
      const { admin } = fakeStorage({ error: null });
      vi.setSystemTime(new Date("2026-09-20T10:00:00Z"));
      const first = await storeSentFile(admin, input);
      vi.setSystemTime(new Date("2026-09-20T11:00:00Z"));
      const second = await storeSentFile(admin, input);
      expect(first).not.toBe(second);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up quietly when storage refuses, rather than failing the download", async () => {
    const { admin } = fakeStorage({ error: { message: "bucket is full" } });
    await expect(storeSentFile(admin, input)).resolves.toBeNull();
  });

  it("gives up quietly when the upload throws", async () => {
    const { admin } = fakeStorage(new Error("network down"));
    await expect(storeSentFile(admin, input)).resolves.toBeNull();
  });
});
