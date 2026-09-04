import { loadEnvLocal } from "./load-env";
loadEnvLocal();

import { createAdminClient } from "../lib/supabase/admin";

/**
 * Generates a working magic-link login URL WITHOUT sending an email —
 * sidesteps Supabase's free-tier email rate limit (2/hour) entirely, since
 * this uses the admin API rather than the mailer. This exercises the exact
 * same login code path as a real emailed link; it's a dev convenience for
 * repeated testing, not a separate/fake auth system.
 */

const email = process.argv[2] || process.env.TEST_ASSOCIATE_EMAIL;
const appUrl = process.env.APP_URL || "http://localhost:3000";

async function main() {
  if (!email) {
    throw new Error("Usage: npx tsx scripts/dev-login-link.ts <email>");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}/auth/callback` },
  });

  if (error) throw error;

  console.log("\nOpen this URL in a browser to log in (no email sent):\n");
  console.log(data.properties.action_link);
  console.log("");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
