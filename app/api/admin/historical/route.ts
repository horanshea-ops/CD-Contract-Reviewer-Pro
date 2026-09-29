import { NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { detectSourceFormat } from "@/lib/document-conversion";
import { storageSafeName } from "@/lib/storage-key";
import { parseHistoricalDetails } from "@/lib/historical/fields";
import { extractHistoricalTerms } from "@/lib/historical/extract";
import { HISTORICAL_BUCKET, historicalExtractionEnabled } from "@/lib/historical/types";

export const maxDuration = 600;

const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * Stores a signed contract from before the tool, with the details an admin
 * enters, for the Analytics tab. Its terms are read by the model afterwards,
 * and only while HISTORICAL_EXTRACTION is on.
 */
export async function POST(request: Request) {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a contract file." }, { status: 400 });

  const byExtension = file.name.toLowerCase().match(/\.(pdf|docx|doc)$/)?.[1] as "pdf" | "docx" | "doc" | undefined;
  const format = detectSourceFormat(file.type) ?? byExtension;
  if (!format) return NextResponse.json({ error: "Unsupported file type. Upload a PDF, DOCX, or DOC contract." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File is too large (${Math.round(file.size / 1024 / 1024)}MB). The limit is 32MB.` }, { status: 400 });
  }

  const parsed = parseHistoricalDetails(form);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const id = randomUUID();
  const storage_path = `historical/${id}/${storageSafeName(file.name)}`;
  const db = createAdminClient();

  const { error: uploadError } = await db.storage
    .from(HISTORICAL_BUCKET)
    .upload(storage_path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ error: "Could not store the file. Try again." }, { status: 500 });

  const extract = historicalExtractionEnabled();
  const { data, error } = await db
    .from("historical_contracts")
    .insert({
      id,
      uploaded_by: actor.id,
      file_name: file.name,
      storage_path,
      source_format: format,
      ...parsed.details,
      extraction_status: extract ? "pending" : "stored",
    })
    .select()
    .single();

  if (error) {
    await db.storage.from(HISTORICAL_BUCKET).remove([storage_path]);
    return NextResponse.json({ error: "Could not save the contract. Try again." }, { status: 500 });
  }

  await logAudit({
    actorId: actor.id,
    action: "historical_contract_uploaded",
    entityType: "historical_contract",
    entityId: id,
    metadata: { hotel_name: parsed.details.hotel_name, file_name: file.name, extraction: extract },
  });

  if (extract) after(() => extractHistoricalTerms(id, actor.id));

  return NextResponse.json(data, { status: 201 });
}
