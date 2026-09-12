import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { assembleExportZip, ZIP_MANIFEST_FILENAME, type ZipEntry } from "@/lib/exports/zip";
import type { ExportBuildResult } from "@/lib/exports/types";

function file(filename: string, body: string): ExportBuildResult {
  return {
    kind: "file",
    filename,
    contentType: "application/pdf",
    bytes: new TextEncoder().encode(body),
    outcome: "clean",
    preflight: null,
    commit: async () => {},
  };
}

function refusal(summary: string): ExportBuildResult {
  return {
    kind: "refusal",
    status: 409,
    body: { error: summary },
    preflight: null,
    summary,
  };
}

async function namesIn(zipBytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(zipBytes);
  return Object.keys(zip.files).sort();
}

describe("assembleExportZip", () => {
  it("packs every delivered file under the name its builder chose", async () => {
    const entries: ZipEntry[] = [
      { format: "memo", result: file("requested-revisions-abc12345.pdf", "memo") },
      { format: "markup", result: file("marked-up-abc12345.pdf", "markup") },
      { format: "clean", result: file("proposed-contract-abc12345.pdf", "clean") },
    ];

    const { zipBytes, included, skipped } = await assembleExportZip(entries);

    expect(included).toEqual(["memo", "markup", "clean"]);
    expect(skipped).toEqual([]);
    expect(await namesIn(zipBytes)).toEqual([
      "marked-up-abc12345.pdf",
      "proposed-contract-abc12345.pdf",
      "requested-revisions-abc12345.pdf",
    ]);

    const zip = await JSZip.loadAsync(zipBytes);
    expect(await zip.file("marked-up-abc12345.pdf")!.async("string")).toBe("markup");
  });

  it("adds no manifest when nothing was skipped", async () => {
    const { zipBytes } = await assembleExportZip([{ format: "memo", result: file("memo.pdf", "memo") }]);
    expect(await namesIn(zipBytes)).toEqual(["memo.pdf"]);
  });

  it("skips a refusal, keeps the rest, and names it in the manifest", async () => {
    const entries: ZipEntry[] = [
      { format: "memo", result: file("memo.pdf", "memo") },
      {
        format: "redline",
        result: refusal("Tracked-changes DOCX: the file did not pass validation and was discarded."),
      },
      { format: "clean", result: refusal("Proposed contract (clean copy): no accepted changes.") },
    ];

    const { zipBytes, included, skipped } = await assembleExportZip(entries);

    expect(included).toEqual(["memo"]);
    expect(skipped.map((s) => s.format)).toEqual(["redline", "clean"]);
    expect(await namesIn(zipBytes)).toEqual([ZIP_MANIFEST_FILENAME, "memo.pdf"]);

    const zip = await JSZip.loadAsync(zipBytes);
    const manifest = await zip.file(ZIP_MANIFEST_FILENAME)!.async("string");
    expect(manifest).toContain("Tracked-changes DOCX: the file did not pass validation and was discarded.");
    expect(manifest).toContain("Proposed contract (clean copy): no accepted changes.");
    expect(manifest).toContain("Nothing about the original contract has changed.");
  });

  it("produces a manifest-only archive when every format refused", async () => {
    const { zipBytes, included } = await assembleExportZip([
      { format: "memo", result: refusal("Requested-revisions memo (PDF): nope.") },
    ]);

    expect(included).toEqual([]);
    expect(await namesIn(zipBytes)).toEqual([ZIP_MANIFEST_FILENAME]);
  });

  it("suffixes rather than overwriting when two formats pick the same filename", async () => {
    const { zipBytes } = await assembleExportZip([
      { format: "markup", result: file("same.pdf", "first") },
      { format: "clean", result: file("same.pdf", "second") },
    ]);

    expect(await namesIn(zipBytes)).toEqual(["same-2.pdf", "same.pdf"]);

    const zip = await JSZip.loadAsync(zipBytes);
    expect(await zip.file("same.pdf")!.async("string")).toBe("first");
    expect(await zip.file("same-2.pdf")!.async("string")).toBe("second");
  });
});
