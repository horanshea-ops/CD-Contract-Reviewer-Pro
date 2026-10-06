import { NextResponse } from "next/server";
import { requireAdmin } from "../admin-guard";
import { historicalContractsEnabled } from "./types";

/**
 * The check behind every historical-contract admin route. While the feature
 * is archived an admin gets 404. A signed-out caller still gets 401, and a
 * non-admin 403.
 */
export async function requireHistoricalAdmin(): ReturnType<typeof requireAdmin> {
  const result = await requireAdmin();
  if (result.denied || historicalContractsEnabled()) return result;
  return { denied: NextResponse.json({ error: "Not found" }, { status: 404 }) };
}
