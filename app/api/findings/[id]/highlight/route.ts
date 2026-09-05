import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPositionedLines } from "@/lib/get-positioned-lines";
import { findHighlightRects } from "@/lib/locate-text";
import type { SourceFormat } from "@/lib/document-conversion";

const STORAGE_BUCKET = "contracts";

/**
 * Highlight rects for one finding, for the in-app PDF viewer's overlay —
 * computed on demand (no persisted bounding boxes, same pattern as the
 * marked-up-PDF export). Unlike that export's auth routes, every non-auth
 * failure here degrades to `{ rects: null }` rather than an error status:
 * this is a progressive-enhancement lookup for a click that already
 * succeeded at jumping the page, so "nothing to show" must never surface as
 * a UI error.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: findingId } = await params;
  const admin = createAdminClient();

  const { data: finding } = await admin
    .from("findings")
    .select("id, analysis_id, is_missing_clause, quoted_text, analyses!inner(associate_id, storage_path, source_format, status)")
    .eq("id", findingId)
    .maybeSingle();

  if (!finding) {
    return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }

  const analysis = (
    finding as unknown as {
      analyses: { associate_id: string; storage_path: string; source_format: SourceFormat; status: string };
    }
  ).analyses;

  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  if (analysis.status !== "complete" || finding.is_missing_clause || !finding.quoted_text) {
    return NextResponse.json({ rects: null });
  }

  let pdfBytes = new Uint8Array();
  if (analysis.source_format === "pdf") {
    const { data: pdfBlob, error: pdfError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(analysis.storage_path);
    if (pdfError || !pdfBlob) {
      return NextResponse.json({ rects: null });
    }
    pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  }

  try {
    const lines = await getPositionedLines({
      admin,
      associateId: analysis.associate_id,
      analysisId: finding.analysis_id,
      sourceFormat: analysis.source_format,
      pdfBytes,
    });
    const rects = findHighlightRects(lines, finding.quoted_text);
    return NextResponse.json({ rects });
  } catch {
    return NextResponse.json({ rects: null });
  }
}
