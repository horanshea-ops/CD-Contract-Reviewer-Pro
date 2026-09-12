import { NextResponse } from "next/server";
import { getCurrentAssociate, type CurrentAssociate } from "../current-associate";
import { createAdminClient } from "../supabase/admin";
import type { SourceFormat } from "../document-conversion";

/**
 * The checks every export route runs before it builds anything — logged in,
 * analysis exists, the associate owns it, the run finished.
 *
 * One select covers all four formats rather than four narrower ones, so the zip
 * route loads the analysis once for however many files it is asked for.
 */

const ANALYSIS_COLUMNS =
  "id, associate_id, filename, status, storage_path, original_storage_path, source_format, intake_route, thread_id, clients(name)";

export interface ExportAnalysis {
  id: string;
  associate_id: string;
  filename: string;
  status: string;
  storage_path: string;
  original_storage_path: string | null;
  source_format: SourceFormat;
  intake_route: "docx_native" | "pdf" | null;
  thread_id: string | null;
  clients: { name: string } | null;
}

export interface ExportContext {
  admin: ReturnType<typeof createAdminClient>;
  associate: CurrentAssociate;
  analysis: ExportAnalysis;
  analysisId: string;
}

export type ExportGate = { ok: true; ctx: ExportContext } | { ok: false; response: NextResponse };

export async function openExport(analysisId: string): Promise<ExportGate> {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }

  const admin = createAdminClient();
  const { data } = await admin.from("analyses").select(ANALYSIS_COLUMNS).eq("id", analysisId).maybeSingle();

  if (!data) {
    return { ok: false, response: NextResponse.json({ error: "Analysis not found." }, { status: 404 }) };
  }

  const analysis = data as unknown as ExportAnalysis;

  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authorized to export this analysis." }, { status: 403 }),
    };
  }
  if (analysis.status !== "complete") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Analysis isn't complete yet." }, { status: 400 }),
    };
  }

  return { ok: true, ctx: { admin, associate, analysis, analysisId } };
}
