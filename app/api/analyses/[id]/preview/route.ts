import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractDocx } from "@/lib/docx";
import { buildPreview } from "@/lib/docx-preview";

const STORAGE_BUCKET = "contracts";

/**
 * The HTML preview for docx_native analyses (MASTER_PLAN.md §1.4a) — the
 * original .docx is re-extracted fresh on every request, never cached: §1.1
 * forbids persisting the map, since a stale one against a re-uploaded file
 * would place a highlight in the wrong part of the document.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis, error } = await admin
    .from("analyses")
    .select("id, associate_id, intake_route, original_storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error || !analysis) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to view this analysis." }, { status: 403 });
  }
  if (analysis.intake_route !== "docx_native" || !analysis.original_storage_path) {
    return NextResponse.json(
      { error: "This analysis doesn't have an HTML preview available." },
      { status: 400 }
    );
  }

  const { data: originalBlob, error: downloadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .download(analysis.original_storage_path);
  if (downloadError || !originalBlob) {
    return NextResponse.json(
      { error: `Could not load the original document: ${downloadError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  try {
    const extracted = await extractDocx(new Uint8Array(await originalBlob.arrayBuffer()));
    return NextResponse.json({ parts: buildPreview(extracted) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read this document.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
