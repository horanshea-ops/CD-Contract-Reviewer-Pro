import { NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";
import { detectSourceFormat, convertToPdf } from "@/lib/document-conversion";
import { extractDocx } from "@/lib/docx";
import type { ExistingRevisions, IntakeHealth } from "@/lib/docx";
import { nextRoundLinkage } from "@/lib/negotiation-threads";
import { storageSafeName } from "@/lib/storage-key";

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
  const negotiationMode = formData.get("negotiationMode") as string | null;
  const propertyName = (formData.get("propertyName") as string | null)?.trim();
  const continuingThreadId = (formData.get("threadId") as string | null)?.trim();

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

  // §1.9.1 — explicit thread linkage, decided before any file processing so a
  // bad choice here fails fast rather than after a DOCX extraction/PDF
  // conversion that would just be thrown away.
  if (negotiationMode !== "new" && negotiationMode !== "continuing") {
    return NextResponse.json(
      { error: "Choose whether this is a new negotiation or continues one already open." },
      { status: 400 }
    );
  }
  if (negotiationMode === "new" && !propertyName) {
    return NextResponse.json({ error: "Property name is required for a new negotiation." }, { status: 400 });
  }
  if (negotiationMode === "continuing" && !continuingThreadId) {
    return NextResponse.json({ error: "Choose which negotiation this continues." }, { status: 400 });
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

  let threadId: string;
  let roundNumber: number;
  let parentAnalysisId: string | null;

  if (negotiationMode === "new") {
    const { data: newThread, error: threadError } = await admin
      .from("negotiation_threads")
      .insert({ associate_id: associate.id, client_id: clientId, property_name: propertyName, status: "open" })
      .select("id")
      .single();
    if (threadError) {
      return NextResponse.json({ error: `Could not start the negotiation: ${threadError.message}` }, { status: 500 });
    }
    threadId = newThread.id;
    roundNumber = 1;
    parentAnalysisId = null;
  } else {
    const { data: thread } = await admin
      .from("negotiation_threads")
      .select("id, status")
      .eq("id", continuingThreadId as string)
      .eq("associate_id", associate.id)
      .maybeSingle();
    if (!thread) {
      return NextResponse.json({ error: "That negotiation was not found." }, { status: 404 });
    }
    if (thread.status !== "open") {
      return NextResponse.json({ error: "That negotiation is no longer open." }, { status: 400 });
    }
    const { data: existingRounds } = await admin
      .from("analyses")
      .select("id, round_number")
      .eq("thread_id", thread.id);
    const linkage = nextRoundLinkage(thread.id, existingRounds ?? []);
    threadId = linkage.threadId;
    roundNumber = linkage.roundNumber;
    parentAnalysisId = linkage.parentAnalysisId;
  }

  const analysisId = randomUUID();
  const fileBytes = Buffer.from(await file.arrayBuffer());

  // Storage keys take a sanitised name; the row keeps `file.name` as typed.
  const keyName = storageSafeName(file.name);

  // A thread was created above, before any of the file work below could fail.
  // Without this, every failed upload leaves an empty negotiation in the
  // "Continuing one" dropdown that an associate can neither use nor remove.
  const fail = async (message: string, status: number) => {
    if (negotiationMode === "new") {
      await admin.from("negotiation_threads").delete().eq("id", threadId);
    }
    return NextResponse.json({ error: message }, { status });
  };

  // Decide at intake, before analysis, whether this document can be safely
  // edited (§1.4.9). Doing it here rather than at export means an associate is
  // told they are getting a PDF markup *before* spending an hour reviewing
  // findings that could never be applied.
  //
  // Legacy .doc predates the OOXML format entirely and uploaded PDFs have no
  // runs to edit, so both take the PDF path unconditionally.
  let intakeHealth: IntakeHealth | null = null;
  let existingRevisions: ExistingRevisions | null = null;
  if (sourceFormat === "docx") {
    try {
      const extracted = await extractDocx(fileBytes, { fileSizeBytes: fileBytes.byteLength });
      intakeHealth = extracted.health;
      existingRevisions = extracted.existingRevisions;
    } catch (err) {
      // Unreadable as OOXML: not fatal, it just cannot take the DOCX path.
      intakeHealth = {
        route: "pdf",
        checks: [{ name: "archive_integrity", passed: false, detail: err instanceof Error ? err.message : String(err) }],
        reason: "This file could not be read as a Word document, so it can't be edited directly.",
      };
    }
  }
  const intakeRoute = sourceFormat === "docx" ? (intakeHealth?.route ?? "pdf") : "pdf";

  let pdfBytes: Uint8Array;
  let originalStoragePath: string | null = null;

  if (sourceFormat === "pdf") {
    pdfBytes = fileBytes;
  } else {
    try {
      const converted = await convertToPdf(fileBytes, sourceFormat, file.name);
      pdfBytes = converted.pdfBytes;

      // Sidecar file recording exactly where each line of text landed on the
      // generated PDF — lets a marked-up-PDF export find a finding's quoted
      // text by exact match instead of fuzzy PDF text-extraction, since we
      // rendered this PDF ourselves and know precisely what we drew.
      const positionsPath = `${associate.id}/${analysisId}/line-positions.json`;
      const { error: positionsUploadError } = await admin.storage
        .from(STORAGE_BUCKET)
        .upload(positionsPath, JSON.stringify(converted.lines), { contentType: "application/json" });
      if (positionsUploadError) {
        return fail(`Could not store document layout data: ${positionsUploadError.message}`, 500);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read this document.";
      return fail(message, 400);
    }

    originalStoragePath = `${associate.id}/${analysisId}/original-${keyName}`;
    const { error: originalUploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(originalStoragePath, fileBytes, { contentType: file.type });
    if (originalUploadError) {
      return fail(`Could not store the original file: ${originalUploadError.message}`, 500);
    }
  }

  const pdfFilename = sourceFormat === "pdf" ? keyName : keyName.replace(/\.docx?$/i, "") + ".pdf";
  const storagePath = `${associate.id}/${analysisId}/${pdfFilename}`;

  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, pdfBytes, { contentType: "application/pdf" });

  if (uploadError) {
    return fail(`Could not store the file: ${uploadError.message}`, 500);
  }

  const { error: insertError } = await admin.from("analyses").insert({
    id: analysisId,
    associate_id: associate.id,
    client_id: clientId,
    filename: file.name,
    storage_path: storagePath,
    source_format: sourceFormat,
    original_storage_path: originalStoragePath,
    intake_route: intakeRoute,
    intake_health: intakeHealth,
    had_existing_revisions: existingRevisions?.present ?? null,
    existing_revision_authors: existingRevisions?.authors ?? null,
    existing_revision_count: existingRevisions?.count ?? null,
    thread_id: threadId,
    round_number: roundNumber,
    parent_analysis_id: parentAnalysisId,
    status: "queued",
  });

  if (insertError) {
    return fail(`Could not create the analysis record: ${insertError.message}`, 500);
  }

  await logAudit({
    actorId: associate.id,
    action: "analysis_upload",
    entityType: "analysis",
    entityId: analysisId,
    metadata: {
      filename: file.name,
      client_name: clientName || null,
      source_format: sourceFormat,
      // Which path the document took, and why if it was downgraded — this is
      // the dataset that tells us which constructs break the engine (§1.6.5).
      intake_route: intakeRoute,
      intake_downgrade_reason: intakeHealth?.reason ?? null,
      thread_id: threadId,
      round_number: roundNumber,
    },
  });

  after(() => processAnalysis(analysisId));

  return NextResponse.json({ analysisId }, { status: 202 });
}
