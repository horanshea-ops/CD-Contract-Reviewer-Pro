import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { getActionedFindings } from "@/lib/get-actioned-findings";
import { generateTrackedChangesDocx } from "@/lib/tracked-changes-docx";

const STORAGE_BUCKET = "contracts";

/**
 * Tracked-changes DOCX export — real Word `w:ins`/`w:del` revision marks on
 * the original uploaded document. DOCX-sourced analyses only: there's no
 * Word document to inject revisions into for PDF- or DOC-sourced ones (see
 * docs/redline-export-plan.md for why).
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
    .select("id, associate_id, filename, original_storage_path, source_format, status")
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
  if (analysis.source_format !== "docx" || !analysis.original_storage_path) {
    return NextResponse.json(
      { error: "Tracked-changes export is only available for contracts uploaded as DOCX." },
      { status: 400 }
    );
  }

  const { data: originalBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.original_storage_path);
  if (downloadError || !originalBlob) {
    return NextResponse.json(
      { error: `Could not load the original document: ${downloadError?.message}` },
      { status: 500 }
    );
  }

  const findings = await getActionedFindings(admin, id);

  let result;
  try {
    result = await generateTrackedChangesDocx({
      originalDocxBytes: new Uint8Array(await originalBlob.arrayBuffer()),
      findings,
      author: associate.name,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate tracked changes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: "redline_docx_exported",
    entityType: "analysis",
    entityId: id,
    metadata: { matched: result.matchedCount, unmatched: result.unmatchedCount },
  });

  const outFilename = analysis.filename.replace(/\.docx$/i, "") + "-redline.docx";
  return new NextResponse(Buffer.from(result.docxBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${outFilename}"`,
    },
  });
}
