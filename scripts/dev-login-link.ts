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

  const rawLink = data.properties.action_link;

  // Resolve the one redirect ourselves — Supabase puts the real
  // access_token/refresh_token in the Location header as a localhost/auth/callback
  // URL fragment. Doing it here saves the curl-then-copy dance every time; if this
  // ever fails (network hiccup, Supabase changing this response shape), the raw
  // link below still works the same way it always has.
  let resolvedUrl: string | null = null;
  try {
    const res = await fetch(rawLink, { redirect: "manual" });
    const location = res.headers.get("location");
    if (location) resolvedUrl = location;
  } catch {
    // Fall through — raw link is printed either way.
  }

  if (resolvedUrl) {
    console.log("\nReady to use — paste this straight into the browser (single-use):\n");
    console.log(resolvedUrl);
    console.log("");
  } else {
    console.log("\nCouldn't resolve the redirect automatically. Open this URL in a browser to log in (no email sent):\n");
    console.log(rawLink);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
