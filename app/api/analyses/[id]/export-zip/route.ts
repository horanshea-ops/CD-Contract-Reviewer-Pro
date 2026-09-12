import { NextResponse } from "next/server";
import { openExport } from "@/lib/exports/context";
import { EXPORT_BUILDERS } from "@/lib/exports/builders";
import { assembleExportZip, type ZipEntry } from "@/lib/exports/zip";
import { contentDisposition } from "@/lib/exports/respond";
import { EXPORT_FORMAT_KEYS, type ExportFormatKey } from "@/lib/exports/types";

/**
 * Several exports as one archive.
 *
 * Four separate downloads from one click is what this replaces — the browser
 * saved one and blocked the rest, and the dialog reported all four as done.
 *
 * Each file that makes it in commits its own `exports` row and audit entry,
 * exactly as a single download would, so §1.6.5's weekly review and §1.6.6's
 * degradation rate read the same either way. A format that refuses is skipped
 * and named in NOT-EXPORTED.txt rather than failing the whole archive; the
 * dialog preflights first, so that normally only catches state that changed
 * between the two requests.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const requested = parseFormats(new URL(request.url).searchParams.get("formats"));
  if ("error" in requested) {
    return NextResponse.json({ error: requested.error }, { status: 400 });
  }

  const gate = await openExport(id);
  if (!gate.ok) return gate.response;

  const entries: ZipEntry[] = [];
  for (const format of requested.formats) {
    entries.push({ format, result: await EXPORT_BUILDERS[format](gate.ctx) });
  }

  // An archive holding nothing but an apology is worse than the refusal itself,
  // so hand back the first reason with its own status instead.
  const firstFile = entries.find((e) => e.result.kind === "file");
  if (!firstFile) {
    const first = entries[0].result;
    if (first.kind === "refusal") return NextResponse.json(first.body, { status: first.status });
  }

  const { zipBytes } = await assembleExportZip(entries);

  for (const { result } of entries) {
    if (result.kind === "file") await result.commit();
    else await result.commit?.();
  }

  return new NextResponse(Buffer.from(zipBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`exports-${id.slice(0, 8)}.zip`),
    },
  });
}

function parseFormats(raw: string | null): { formats: ExportFormatKey[] } | { error: string } {
  const asked = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (asked.length === 0) return { error: "Name at least one format to export." };

  const unknown = asked.filter((f) => !EXPORT_FORMAT_KEYS.includes(f as ExportFormatKey));
  if (unknown.length > 0) return { error: `Unknown export format: ${unknown.join(", ")}.` };

  // Fixed order, so the archive reads the same however the boxes were ticked.
  const wanted = new Set(asked);
  return { formats: EXPORT_FORMAT_KEYS.filter((f) => wanted.has(f)) };
}
