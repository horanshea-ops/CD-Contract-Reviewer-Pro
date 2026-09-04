import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createAdminClient } from "../lib/supabase/admin";

/** Creates the private storage bucket contract files are uploaded into. Safe to re-run. */

const BUCKET = "contracts";

async function main() {
  const admin = createAdminClient();
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) throw listError;

  if (buckets.some((b) => b.name === BUCKET)) {
    console.log(`Bucket "${BUCKET}" already exists.`);
    return;
  }

  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: "50MB",
    allowedMimeTypes: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ],
  });
  if (error) throw error;
  console.log(`Created bucket "${BUCKET}".`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
