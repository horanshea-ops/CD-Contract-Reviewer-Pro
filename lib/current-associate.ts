import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";

export interface CurrentAssociate {
  id: string;
  email: string;
  name: string;
  is_admin: boolean;
}

/**
 * Resolves the logged-in Supabase Auth user to their row in `associates`.
 * Returns null if there's no session or the email isn't an active
 * allowlist entry (shouldn't normally happen post-login, since the callback
 * flow already checks this — but every server route re-checks rather than
 * trusting the client).
 */
export async function getCurrentAssociate(): Promise<CurrentAssociate | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("associates")
    .select("id, email, name, is_admin, status")
    .eq("email", user.email)
    .maybeSingle();

  if (!data || data.status !== "active") return null;

  return { id: data.id, email: data.email, name: data.name, is_admin: data.is_admin };
}
