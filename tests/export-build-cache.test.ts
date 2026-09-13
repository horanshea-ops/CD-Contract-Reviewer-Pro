import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cachedBuild, fingerprint, clearBuildCache } from "@/lib/exports/build-cache";

beforeEach(() => clearBuildCache());
afterEach(() => vi.useRealTimers());

describe("fingerprint", () => {
  it("matches for equal inputs and differs when a finding changes", () => {
    const findings = [{ id: "a", language: "Group shall pay." }];
    expect(fingerprint(["doc.docx", findings])).toBe(fingerprint(["doc.docx", findings]));

    const edited = [{ id: "a", language: "Group shall not pay." }];
    expect(fingerprint(["doc.docx", edited])).not.toBe(fingerprint(["doc.docx", findings]));
  });

  it("separates a different source document", () => {
    expect(fingerprint(["a.docx", []])).not.toBe(fingerprint(["b.docx", []]));
  });
});

describe("cachedBuild", () => {
  it("builds once for repeated calls with the same inputs", async () => {
    const build = vi.fn(async () => ({ bytes: "first" }));

    const a = await cachedBuild("k", "fp1", build);
    const b = await cachedBuild("k", "fp1", build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  // The safety property. An associate who changes a decision between the
  // preflight and the download must get the document their decision produces.
  it("rebuilds when the inputs changed", async () => {
    const first = vi.fn(async () => "before the edit");
    const second = vi.fn(async () => "after the edit");

    await cachedBuild("k", "fp1", first);
    const out = await cachedBuild("k", "fp2", second);

    expect(second).toHaveBeenCalledTimes(1);
    expect(out).toBe("after the edit");
  });

  it("keeps separate keys apart", async () => {
    await cachedBuild("redline", "fp", async () => "docx");
    const pdf = await cachedBuild("clean", "fp", async () => "pdf");

    expect(pdf).toBe("pdf");
    expect(await cachedBuild("redline", "fp", async () => "rebuilt")).toBe("docx");
  });

  it("rebuilds once the entry has expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T00:00:00Z"));

    const build = vi.fn(async () => "bytes");
    await cachedBuild("k", "fp", build);

    vi.setSystemTime(new Date("2026-09-12T00:06:00Z"));
    await cachedBuild("k", "fp", build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("drops the oldest entries rather than growing without bound", async () => {
    for (let i = 0; i < 12; i++) {
      await cachedBuild(`k${i}`, "fp", async () => i);
    }

    const rebuilt = vi.fn(async () => -1);
    await cachedBuild("k0", "fp", rebuilt);
    expect(rebuilt).toHaveBeenCalledTimes(1);

    // The most recent writes are still there.
    const recent = vi.fn(async () => -1);
    expect(await cachedBuild("k11", "fp", recent)).toBe(11);
    expect(recent).not.toHaveBeenCalled();
  });

  it("caches nothing when the build throws", async () => {
    const failing = vi.fn(async () => {
      throw new Error("engine failed");
    });
    await expect(cachedBuild("k", "fp", failing)).rejects.toThrow("engine failed");

    const ok = vi.fn(async () => "recovered");
    expect(await cachedBuild("k", "fp", ok)).toBe("recovered");
  });
});
