import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { generateRevisionsMemo, type MemoFinding } from "@/lib/export-memo";

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

  const { data: findingRows } = await admin
    .from("findings")
    .select("id, clause_type, severity, is_missing_clause, quoted_text, finding_text, cd_standard, proposed_language")
    .eq("analysis_id", id);

  const findingIds = (findingRows ?? []).map((f) => f.id);
  const { data: actionRows } = findingIds.length
    ? await admin
        .from("finding_actions")
        .select("finding_id, action, edited_language, created_at")
        .in("finding_id", findingIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const latestActionByFinding = new Map<
    string,
    { action: string; edited_language: string | null }
  >();
  for (const row of actionRows ?? []) {
    if (!latestActionByFinding.has(row.finding_id)) {
      latestActionByFinding.set(row.finding_id, { action: row.action, edited_language: row.edited_language });
    }
  }

  const severityOrder: Record<string, number> = { high: 0, medium: 1, low: 2, note: 3 };
  const memoFindings: MemoFinding[] = (findingRows ?? [])
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter((x): x is { f: NonNullable<typeof x.f>; action: NonNullable<typeof x.action> } =>
      x.action != null && (x.action.action === "accept" || x.action.action === "edit")
    )
    .sort((a, b) => severityOrder[a.f.severity] - severityOrder[b.f.severity])
    .map(({ f, action }) => ({
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
    }));

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
