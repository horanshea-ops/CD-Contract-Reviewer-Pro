import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsEnabled, sharesOriginals } from "@/lib/analytics/source";
import { HISTORICAL_BUCKET, historicalContractsEnabled } from "@/lib/historical/types";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
} as const;

/**
 * Opens a historical contract's original file. The same rule as a review's
 * original: an admin, the associate who negotiated it, or anyone while
 * ANALYTICS_SHARE_ORIGINALS is on.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  // Both screens that link here are archived. Either one switched on reopens it.
  if (!historicalContractsEnabled() && !analyticsEnabled()) {
    return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  }

  const { id } = await params;
  const db = createAdminClient();
  const { data: row } = await db
    .from("historical_contracts")
    .select("storage_path, source_format, file_name, negotiated_by")
    .eq("id", id)
    .maybeSingle();

  const allowed = row && (associate.is_admin || row.negotiated_by === associate.id || sharesOriginals());
  if (!allowed) return NextResponse.json({ error: "Contract not found." }, { status: 404 });

  const { data: blob, error } = await db.storage.from(HISTORICAL_BUCKET).download(row.storage_path);
  if (error || !blob) return NextResponse.json({ error: "Could not open the file." }, { status: 500 });

  const format = row.source_format as keyof typeof CONTENT_TYPES;
  const disposition = format === "pdf" ? "inline" : "attachment";
  return new NextResponse(blob, {
    headers: {
      "Content-Type": CONTENT_TYPES[format],
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
    },
  });
}
