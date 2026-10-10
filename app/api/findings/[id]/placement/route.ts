import { NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { getCurrentAssociate } from "@/lib/current-associate";
import { NumberingResolver, loadDocx, walkPart } from "@/lib/docx";
import { latestActions } from "@/lib/finding-actions";
import { placementProblem, placementRow, type PlacementInput } from "@/lib/placement";
import { createAdminClient } from "@/lib/supabase/admin";

const STORAGE_BUCKET = "contracts";

/**
 * Gives a change a place, by the associate's choice: the contract wording it
 * replaces, or the email to the property in place of the redline.
 *
 * Wording is checked against the Word file before it is saved, so a pick that
 * the redline couldn't use is refused here, with a sentence saying what to do.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id: findingId } = await params;
  const input = (await request.json()) as PlacementInput;
  if (input.quote === undefined && input.byEmail === undefined) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: finding } = await admin
    .from("findings")
    .select("id, analysis_id, category, location_section, analyses!inner(associate_id, original_storage_path)")
    .eq("id", findingId)
    .maybeSingle();
  if (!finding) {
    return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }

  const analysis = (finding as unknown as { analyses: { associate_id: string; original_storage_path: string | null } }).analyses;
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  if (finding.category === "legal") {
    return NextResponse.json({ error: "Legal findings take no wording, so they have no place in the contract's files." }, { status: 400 });
  }

  if (input.quote !== undefined) {
    if (!analysis.original_storage_path) {
      return NextResponse.json({ error: "This contract has no Word file to place a change in." }, { status: 400 });
    }
    const { data: blob, error } = await admin.storage.from(STORAGE_BUCKET).download(analysis.original_storage_path);
    if (error || !blob) {
      return NextResponse.json({ error: "Could not load the original document." }, { status: 500 });
    }
    const pkg = await loadDocx(new Uint8Array(await blob.arrayBuffer()));
    const numbering = new NumberingResolver(pkg.numbering, pkg.styles);
    const parts = pkg.textParts.map((p) => walkPart(p, numbering));

    const problem = placementProblem(parts, input.quote, finding.location_section, input.context ?? null);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const latest = (await latestActions(admin, [findingId])).get(findingId) ?? null;
  const row = placementRow(latest, input);
  const { data: saved, error: insertError } = await admin
    .from("finding_actions")
    .insert({ finding_id: findingId, associate_id: associate.id, ...row })
    .select()
    .single();
  if (insertError) {
    return NextResponse.json({ error: `Could not save: ${insertError.message}` }, { status: 500 });
  }

  await logAudit({
    actorId: associate.id,
    action: row.by_email ? "finding_sent_by_email" : "finding_placed",
    entityType: "finding",
    entityId: findingId,
    metadata: { analysis_id: finding.analysis_id, picked_wording: input.quote !== undefined },
  });

  return NextResponse.json(saved);
}
