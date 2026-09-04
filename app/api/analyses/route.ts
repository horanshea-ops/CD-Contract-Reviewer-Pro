import { NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "crypto";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { processAnalysis } from "@/lib/analysis-pipeline";

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

  if (file.type !== "application/pdf") {
    return NextResponse.json(
      {
        error:
          "Only PDF is supported right now. DOCX/DOC support is planned but not built yet — please export or print the contract to PDF and try again.",
      },
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
  const storagePath = `${associate.id}/${analysisId}/${file.name}`;

  const fileBytes = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, fileBytes, { contentType: file.type });

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
    metadata: { filename: file.name, client_name: clientName || null },
  });

  after(() => processAnalysis(analysisId));

  return NextResponse.json({ analysisId }, { status: 202 });
}
