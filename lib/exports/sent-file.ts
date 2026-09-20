import { storageSafeName } from "../storage-key";
import type { createAdminClient } from "../supabase/admin";

const STORAGE_BUCKET = "contracts";

/**
 * Keeps the tracked-changes file an associate actually sent (§1.9.4).
 *
 * Round N+1's diff compares what we sent against what came back, and what we
 * sent cannot be rebuilt with any confidence once a finding's decision changes.
 * The rebuild would be a document nobody ever saw, and a diff against it blames
 * the property for our own later edit. So the bytes are kept.
 *
 * Every export gets its own file rather than overwriting the last, because two
 * exports of one analysis are two different documents and the `exports` row
 * that points at each one records which was which.
 *
 * Best-effort throughout. An export that reached the associate must not fail
 * because the copy did, which is the same posture recordExport takes.
 */
export async function storeSentFile(
  admin: ReturnType<typeof createAdminClient>,
  { associateId, analysisId, filename, bytes, contentType }: {
    associateId: string;
    analysisId: string;
    filename: string;
    bytes: Uint8Array;
    contentType: string;
  }
): Promise<string | null> {
  const path = `${associateId}/${analysisId}/sent/${Date.now()}-${storageSafeName(filename, "redline.docx")}`;

  try {
    const { error } = await admin.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType });
    if (error) {
      console.error(`Could not keep the sent file for ${analysisId}: ${error.message}`);
      return null;
    }
    return path;
  } catch (err) {
    console.error(`Could not keep the sent file for ${analysisId}:`, err);
    return null;
  }
}
