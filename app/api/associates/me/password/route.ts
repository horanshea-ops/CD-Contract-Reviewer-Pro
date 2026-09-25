import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { passwordProblem } from "@/lib/password-rules";

/**
 * Sets the signed-in associate's password. It runs on their own session, so
 * nobody can set a password for anyone else.
 */
export async function POST(request: Request) {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = typeof body.confirm === "string" ? body.confirm : "";

  const problem = passwordProblem(password, confirm);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit({
    actorId: associate.id,
    action: "password_set",
    entityType: "associate",
    entityId: associate.id,
  });

  return NextResponse.json({ ok: true });
}
