import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createAdminClient } from "../lib/supabase/admin";

/** Creates (or updates) the private storage bucket contract files are uploaded into. Safe to re-run. */

const BUCKET = "contracts";

const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: "50MB",
  allowedMimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/json", // sidecar line-position data for DOCX/DOC-sourced marked-up PDF export
  ],
};

async function main() {
  const admin = createAdminClient();
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) throw listError;

  if (buckets.some((b) => b.name === BUCKET)) {
    const { error } = await admin.storage.updateBucket(BUCKET, BUCKET_OPTIONS);
    if (error) throw error;
    console.log(`Updated bucket "${BUCKET}".`);
    return;
  }

  const { error } = await admin.storage.createBucket(BUCKET, BUCKET_OPTIONS);
  if (error) throw error;
  console.log(`Created bucket "${BUCKET}".`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
