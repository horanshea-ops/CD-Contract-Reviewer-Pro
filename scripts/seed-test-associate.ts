import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createAdminClient } from "../lib/supabase/admin";

/**
 * Adds one associate to the allowlist table for local testing, so there's
 * something to log in as before the real admin screen (build brief §11,
 * item 7) exists. Safe to re-run — upserts on email.
 */

const TEST_EMAIL = process.argv[2] || process.env.TEST_ASSOCIATE_EMAIL;
const TEST_NAME = process.argv[3] || "Test Associate";

async function main() {
  if (!TEST_EMAIL) {
    throw new Error("Usage: npx tsx scripts/seed-test-associate.ts <email> [name]");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("associates")
    .upsert(
      { email: TEST_EMAIL, name: TEST_NAME, status: "active", is_admin: true },
      { onConflict: "email" }
    )
    .select();

  if (error) throw error;
  console.log("Upserted associate:", data);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
