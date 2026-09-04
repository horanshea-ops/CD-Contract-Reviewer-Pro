import { NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";
import { detectSourceFormat, convertToPdf } from "@/lib/document-conversion";

export const maxDuration = 300;

const STORAGE_BUCKET = "contracts";
const MAX_FILE_BYTES = 32 * 1024 * 1024; // 32MB — see build brief §5 on checking current PDF limits

/**
 * Kicks off an analysis: stores the file, inserts a "queued" row, responds
 * immediately (§5 — don't hold the request open for 30-90s), and runs the
 * actual pipeline via after() so the client polls GET /api/analyses/:id
 * for status instead.
 */
export async function POST(request: Request) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const clientName = (formData.get("clientName") as string | null)?.trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const sourceFormat = detectSourceFormat(file.type);
  if (!sourceFormat) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF, DOCX, or DOC contract." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). The limit is 32MB.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  let clientId: string | null = null;
  if (clientName) {
    const { data: existingClient } = await admin
      .from("clients")
      .select("id")
      .eq("name", clientName)
      .maybeSingle();

    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientError } = await admin
        .from("clients")
        .insert({ name: clientName })
        .select("id")
        .single();
      if (clientError) {
        return NextResponse.json({ error: "Could not save client name." }, { status: 500 });
      }
      clientId = newClient.id;
    }
  }

  const analysisId = randomUUID();
  const fileBytes = Buffer.from(await file.arrayBuffer());

  let pdfBytes: Uint8Array;
  let originalStoragePath: string | null = null;

  if (sourceFormat === "pdf") {
    pdfBytes = fileBytes;
  } else {
    try {
      pdfBytes = await convertToPdf(fileBytes, sourceFormat, file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read this document.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    originalStoragePath = `${associate.id}/${analysisId}/original-${file.name}`;
    const { error: originalUploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(originalStoragePath, fileBytes, { contentType: file.type });
    if (originalUploadError) {
      return NextResponse.json(
        { error: `Could not store the original file: ${originalUploadError.message}` },
        { status: 500 }
      );
    }
  }

  const pdfFilename = sourceFormat === "pdf" ? file.name : file.name.replace(/\.(docx?|DOCX?)$/, "") + ".pdf";
  const storagePath = `${associate.id}/${analysisId}/${pdfFilename}`;

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf" });

  if (uploadError) {
    return NextResponse.json(
      { error: `Could not store the file: ${uploadError.message}` },
      { status: 500 }
    );
  }

  const { error: insertError } = await admin.from("analyses").insert({
    id: analysisId,
    associate_id: associate.id,
    client_id: clientId,
    filename: file.name,
    storage_path: storagePath,
    source_format: sourceFormat,
    original_storage_path: originalStoragePath,
    status: "queued",
  });

  if (insertError) {
    return NextResponse.json(
      { error: `Could not create the analysis record: ${insertError.message}` },
      { status: 500 }
    );
  }

  await logAudit({
    actorId: associate.id,
    action: "analysis_upload",
    entityType: "analysis",
    entityId: analysisId,
    metadata: { filename: file.name, client_name: clientName || null, source_format: sourceFormat },
  });

  after(() => processAnalysis(analysisId));

  return NextResponse.json({ analysisId }, { status: 202 });
}
