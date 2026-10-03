import { NextResponse } from "next/server";
import { getCurrentAssociate, type CurrentAssociate } from "./current-associate";

/**
 * The server-side check behind every admin route. Hiding a nav link is not
 * access control, so each route calls this before doing anything.
 */
export async function requireAdmin(): Promise<{ admin: CurrentAssociate; denied?: never } | { admin?: never; denied: NextResponse }> {
  const associate = await getCurrentAssociate();
  if (!associate) return { denied: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  if (!associate.is_admin) return { denied: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  return { admin: associate };
}
