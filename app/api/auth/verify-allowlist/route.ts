import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";

/**
 * Called right after a session is established (from either the PKCE `code`
 * flow or the implicit `#access_token` flow — see app/auth/callback/page.tsx).
 * A successful Supabase Auth login is not by itself enough to use the app;
 * the email also has to be an active row in `associates`, the allowlist
 * table CD controls (build brief §4.2). Signs the user back out if not.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ authorized: false, reason: "no_session" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: associate } = await admin
    .from("associates")
    .select("id, status")
    .eq("email", user.email)
    .maybeSingle();

  if (associate?.status === "active") {
    await logAudit({
      actorId: associate.id,
      action: "login",
      entityType: "associate",
      entityId: associate.id,
    });
    return NextResponse.json({ authorized: true });
  }

  await logAudit({
    actorId: null,
    action: "login_denied",
    entityType: "associate",
    metadata: { email: user.email, reason: associate ? "revoked" : "not_on_allowlist" },
  });

  await supabase.auth.signOut();
  return NextResponse.json({ authorized: false, reason: "not_on_allowlist" }, { status: 403 });
}
