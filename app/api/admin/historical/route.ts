import { NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { requireHistoricalAdmin } from "@/lib/historical/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { detectSourceFormat } from "@/lib/document-conversion";
import { storageSafeName } from "@/lib/storage-key";
import { aiClauseMatches, readContractText } from "@/lib/historical/extract";
import { HISTORICAL_BUCKET, LIST_COLUMNS } from "@/lib/historical/types";

export const maxDuration = 120;

const MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * Stores one past contract. The admin enters nothing: the file's text is read
 * locally here, at no cost, and its details are filled in when the contract
 * is read. The same file uploaded again is skipped.
 */
export async function POST(request: Request) {
  const { admin: actor, denied } = await requireHistoricalAdmin();
  if (denied) return denied;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a contract file." }, { status: 400 });

  const byExtension = file.name.toLowerCase().match(/\.(pdf|docx|doc)$/)?.[1] as "pdf" | "docx" | "doc" | undefined;
  const format = detectSourceFormat(file.type) ?? byExtension;
  if (!format) return NextResponse.json({ error: "Not a PDF, DOCX or DOC file." }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Larger than 32MB." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const file_sha256 = createHash("sha256").update(bytes).digest("hex");

  const db = createAdminClient();
  const { data: existing } = await db.from("historical_contracts").select("id, file_name").eq("file_sha256", file_sha256).maybeSingle();
  if (existing) return NextResponse.json({ duplicate: true, existing });

  let text;
  try {
    text = await readContractText(bytes, format);
  } catch {
    return NextResponse.json({ error: "The file couldn't be opened. It may be damaged or password-protected." }, { status: 400 });
  }
  const aiMatches = aiClauseMatches(text);

  const id = randomUUID();
  const storage_path = `historical/${id}/${storageSafeName(file.name)}`;
  const { error: uploadError } = await db.storage
    .from(HISTORICAL_BUCKET)
    .upload(storage_path, Buffer.from(bytes), { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ error: "Couldn't store the file. Try again." }, { status: 500 });

  const { data, error } = await db
    .from("historical_contracts")
    .insert({
      id,
      uploaded_by: actor.id,
      file_name: file.name,
      storage_path,
      source_format: format,
      file_sha256,
      ...text,
      extraction_status: aiMatches.length ? "blocked_ai_clause" : "waiting",
      term_extraction: aiMatches.length ? { status: "blocked_ai_clause", matches: aiMatches } : null,
    })
    .select(LIST_COLUMNS)
    .single();

  if (error) {
    await db.storage.from(HISTORICAL_BUCKET).remove([storage_path]);
    return NextResponse.json({ error: "Couldn't save the contract. Try again." }, { status: 500 });
  }

  await logAudit({
    actorId: actor.id,
    action: "historical_contract_uploaded",
    entityType: "historical_contract",
    entityId: id,
    metadata: { file_name: file.name, ai_clause: aiMatches.length > 0 },
  });

  return NextResponse.json(data, { status: 201 });
}
