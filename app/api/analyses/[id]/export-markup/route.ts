import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { generateMarkupPdf } from "@/lib/redline-pdf";
import { getPositionedLines } from "@/lib/get-positioned-lines";

const STORAGE_BUCKET = "contracts";

/**
 * Marked-up PDF export — strikethrough + numbered margin markers on the
 * actual document, with full detail in an appendix. Works for every source
 * format now: DOCX/DOC-sourced analyses use the exact line-position data
 * recorded when we generated that PDF ourselves (lib/text-to-pdf.ts);
 * genuinely PDF-sourced analyses use real PDF text extraction
 * (lib/extract-pdf-lines.ts). Either way, lib/redline-pdf.ts's
 * matching/drawing logic is unchanged — it just takes positioned text.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, filename, storage_path, source_format, status")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to export this analysis." }, { status: 403 });
  }
  if (analysis.status !== "complete") {
    return NextResponse.json({ error: "Analysis isn't complete yet." }, { status: 400 });
  }

  const { data: pdfBlob, error: pdfError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.storage_path);
  if (pdfError || !pdfBlob) {
    return NextResponse.json({ error: `Could not load the document: ${pdfError?.message}` }, { status: 500 });
  }
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

  let lines;
  try {
    lines = await getPositionedLines({
      admin,
      associateId: analysis.associate_id,
      analysisId: id,
      sourceFormat: analysis.source_format,
      pdfBytes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this document's text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const findings = await getActionedFindings(admin, id);
  const markupBytes = await generateMarkupPdf({ pdfBytes, lines, findings });

  await logAudit({
    actorId: associate.id,
    action: "markup_exported",
    entityType: "analysis",
    entityId: id,
    metadata: { findings_included: findings.length, source_format: analysis.source_format },
  });

  return new NextResponse(Buffer.from(markupBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="marked-up-${id.slice(0, 8)}.pdf"`,
    },
  });
}
