import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { generateRevisionsMemo } from "@/lib/export-memo";
import { getActionedFindings } from "@/lib/get-actioned-findings";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id, filename, status, clients(name)")
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

  const memoFindings = await getActionedFindings(admin, id);

  const pdfBytes = await generateRevisionsMemo({
    contractFilename: analysis.filename,
    clientName: (analysis.clients as unknown as { name: string } | null)?.name ?? null,
    associateName: associate.name,
    findings: memoFindings,
  });

  await logAudit({
    actorId: associate.id,
    action: "memo_exported",
    entityType: "analysis",
    entityId: id,
    metadata: { findings_included: memoFindings.length },
  });

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="requested-revisions-${id.slice(0, 8)}.pdf"`,
    },
  });
}
