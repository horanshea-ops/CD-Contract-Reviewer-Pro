import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { generateMarkupPdf } from "@/lib/redline-pdf";
import type { RenderedLine } from "@/lib/text-to-pdf";

const STORAGE_BUCKET = "contracts";

/**
 * Marked-up PDF export — strikethrough + numbered margin markers on the
 * actual document, with full detail in an appendix. Phase A: DOCX/DOC-
 * sourced analyses only, since locating quoted text relies on the exact
 * line-position data recorded when we generated that PDF ourselves (see
 * lib/text-to-pdf.ts). Genuinely PDF-sourced analyses need real PDF text
 * extraction and fuzzy matching — a separate, harder phase, not built yet.
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
  if (analysis.source_format === "pdf") {
    return NextResponse.json(
      { error: "Marked-up export isn't available yet for contracts uploaded as PDF — only DOCX/DOC for now." },
      { status: 400 }
    );
  }

  const positionsPath = `${analysis.associate_id}/${id}/line-positions.json`;
  const [{ data: pdfBlob, error: pdfError }, { data: positionsBlob, error: positionsError }] = await Promise.all([
    admin.storage.from(STORAGE_BUCKET).download(analysis.storage_path),
    admin.storage.from(STORAGE_BUCKET).download(positionsPath),
  ]);

  if (pdfError || !pdfBlob) {
    return NextResponse.json({ error: `Could not load the document: ${pdfError?.message}` }, { status: 500 });
  }
  if (positionsError || !positionsBlob) {
    return NextResponse.json(
      { error: `Could not load document layout data: ${positionsError?.message}` },
      { status: 500 }
    );
  }

  const lines: RenderedLine[] = JSON.parse(await positionsBlob.text());
  const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const findings = await getActionedFindings(admin, id);

  const markupBytes = await generateMarkupPdf({ pdfBytes, lines, findings });

  await logAudit({
    actorId: associate.id,
    action: "markup_exported",
    entityType: "analysis",
    entityId: id,
    metadata: { findings_included: findings.length },
  });

  return new NextResponse(Buffer.from(markupBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="marked-up-${id.slice(0, 8)}.pdf"`,
    },
  });
}
