import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectSourceFormat } from "@/lib/document-conversion";
import { readBrand, readPropertyName } from "@/lib/intake/read";
import { readContractText } from "@/lib/read-contract-text";
import { brandChoices } from "@/lib/standards/usable";

export const maxDuration = 60;

const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** The brands the upload screen lists, before any file is picked. */
export async function GET() {
  const associate = await getCurrentAssociate();
  if (!associate) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json({ sets: await brandChoices(createAdminClient()) });
}

/**
 * Reads the property name and the hotel brand off a contract before it is
 * uploaded for review, so the associate can confirm them (CLAUDE.md deviation
 * 10).
 *
 * The read is local rules over the file's own text. Nothing is stored, no
 * audit row is written, and no model is called. A file that can't be read
 * returns empty fields, and the associate fills them in as before.
 */
export async function POST(request: Request) {
  const associate = await getCurrentAssociate();
  if (!associate) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });

  const format = detectSourceFormat(file.type);
  if (!format) {
    return NextResponse.json({ error: "Unsupported file type. Upload a PDF, DOCX, or DOC contract." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File is too large. The limit is 32MB." }, { status: 400 });
  }

  const db = createAdminClient();
  const sets = await brandChoices(db);

  let text: string;
  try {
    text = (await readContractText(new Uint8Array(await file.arrayBuffer()), format)).contract_text;
  } catch {
    // A file the review itself can still convert. Nothing was read, so nothing is filled in.
    return NextResponse.json({ propertyName: null, brand: { brand: null, set: null, evidence: null, note: null }, sets });
  }

  const propertyName = readPropertyName(text);
  // The hotel's actual brand, whether or not it has standards of its own. The form says which standards a review will read.
  const brand = readBrand(text, propertyName?.value ?? null, sets);

  return NextResponse.json({ propertyName, brand, sets });
}
