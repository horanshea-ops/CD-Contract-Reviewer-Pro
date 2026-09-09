import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * §1.8.7 — the one piece of "voice" this pass builds: a per-associate
 * signature block, edited inline on the email-draft panel rather than a
 * dedicated settings screen, which doesn't exist yet.
 */
export async function PATCH(request: Request) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const signatureBlock = body?.signatureBlock;
  if (typeof signatureBlock !== "string") {
    return NextResponse.json({ error: "signatureBlock must be a string." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("associates")
    .update({ signature_block: signatureBlock })
    .eq("id", associate.id);

  if (error) {
    return NextResponse.json({ error: `Could not save your signature: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
