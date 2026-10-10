import type { createAdminClient } from "./supabase/admin";

const STORAGE_BUCKET = "contracts";
const READ_TRIES = 3;
const RETRY_WAIT_MS = 400;

/**
 * The Word file as uploaded, for a review that reads it.
 *
 * A slow or dropped read from storage is tried again. When it still fails the
 * review fails with it, before the model is called. Reading the converted PDF
 * in its place would cost the same and give findings quoted from other text
 * than the review screen checks them against.
 */
export async function readOriginalDocx(
  admin: Pick<ReturnType<typeof createAdminClient>, "storage">,
  path: string,
  waitMs = RETRY_WAIT_MS
): Promise<Uint8Array> {
  let reason = "";
  for (let attempt = 1; attempt <= READ_TRIES; attempt++) {
    try {
      const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
      if (data && !error) return new Uint8Array(await data.arrayBuffer());
      reason = error?.message ?? "the file came back empty";
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err);
    }
    console.warn(`readOriginalDocx: read ${attempt} of ${READ_TRIES} failed — ${reason}`);
    if (attempt < READ_TRIES) await new Promise((resolve) => setTimeout(resolve, waitMs * attempt));
  }
  throw new Error(`The Word file couldn't be read, so nothing was reviewed (${reason}). Use Retry to run it again.`);
}
