import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit";
import { collectEnded, sendWaiting } from "@/lib/historical/extract";
import { historicalExtractionEnabled } from "@/lib/historical/types";

export const maxDuration = 300;

/**
 * Sends the next group of waiting contracts to the Batch service, at half the
 * price of reading them one at a time. The screen calls this again until none
 * are left waiting.
 */
export async function POST() {
  const { admin: actor, denied } = await requireAdmin();
  if (denied) return denied;
  if (!historicalExtractionEnabled()) {
    return NextResponse.json({ error: "Reading historical contracts is switched off." }, { status: 409 });
  }

  const db = createAdminClient();
  try {
    const result = await sendWaiting(db, actor.id);
    if (result.sent > 0) {
      await logAudit({ actorId: actor.id, action: "historical_batch_sent", entityType: "historical_batch", metadata: result });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("historical batch send failed:", err);
    return NextResponse.json({ error: "Couldn't send the contracts to be read. Try again." }, { status: 502 });
  }
}

/** Stores the results of any batch that has finished. Safe to call on every page load. */
export async function GET() {
  const { denied } = await requireAdmin();
  if (denied) return denied;

  try {
    return NextResponse.json(await collectEnded(createAdminClient()));
  } catch (err) {
    console.error("historical batch collect failed:", err);
    return NextResponse.json({ error: "Couldn't check on the contracts being read." }, { status: 502 });
  }
}
