import JSZip from "jszip";
import type { ExportBuildResult, ExportFormatKey } from "./types";

export const ZIP_MANIFEST_FILENAME = "NOT-EXPORTED.txt";

export interface ZipEntry {
  format: ExportFormatKey;
  result: ExportBuildResult;
}

export interface AssembledZip {
  zipBytes: Uint8Array;
  /** The formats that produced a file, in the order they were zipped. */
  included: ExportFormatKey[];
  /** The formats that produced nothing, with the reason each one gave. */
  skipped: { format: ExportFormatKey; summary: string }[];
}

/**
 * Packs whatever the builders produced into one archive.
 *
 * A format that refused is skipped rather than failing the whole export, and
 * the reasons go into NOT-EXPORTED.txt inside the zip so they travel with the
 * file. An associate who opens the archive a week later still sees why three
 * files arrived instead of four.
 *
 * Pure over its input — it commits nothing and touches no database.
 */
export async function assembleExportZip(entries: ZipEntry[]): Promise<AssembledZip> {
  const zip = new JSZip();
  const included: ExportFormatKey[] = [];
  const skipped: { format: ExportFormatKey; summary: string }[] = [];
  const usedNames = new Set<string>();

  for (const { format, result } of entries) {
    if (result.kind === "refusal") {
      skipped.push({ format, summary: result.summary });
      continue;
    }
    zip.file(uniqueName(result.filename, usedNames), result.bytes);
    included.push(format);
  }

  if (skipped.length > 0) {
    zip.file(ZIP_MANIFEST_FILENAME, manifestText(skipped));
  }

  const zipBytes = await zip.generateAsync({ type: "uint8array" });
  return { zipBytes, included, skipped };
}

function manifestText(skipped: { format: ExportFormatKey; summary: string }[]): string {
  const lines = [
    "Some of the files you asked for are not in this archive.",
    "",
    ...skipped.map((s) => `- ${s.summary}`),
    "",
    "Nothing about the original contract has changed.",
  ];
  return lines.join("\n") + "\n";
}

/** Two formats can land on the same name. Suffix rather than overwrite one silently. */
function uniqueName(filename: string, used: Set<string>): string {
  if (!used.has(filename)) {
    used.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n++;
  const name = `${stem}-${n}${ext}`;
  used.add(name);
  return name;
}
