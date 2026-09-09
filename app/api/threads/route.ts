import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lists the current associate's open negotiations, for the upload picker
 * (§1.9.1 — "revision of…"). Each one is annotated with how many rounds it
 * already has, so the picker can show real context rather than a bare name.
 */
export async function GET() {
  const associate = await getCurrentAssociate();
  if (!associate) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: threads, error } = await admin
    .from("negotiation_threads")
    .select("id, property_name, clients(name)")
    .eq("associate_id", associate.id)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: `Could not load negotiations: ${error.message}` }, { status: 500 });
  }
  if (!threads || threads.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  const { data: rounds } = await admin
    .from("analyses")
    .select("thread_id")
    .in(
      "thread_id",
      threads.map((t) => t.id)
    );

  const roundCounts = new Map<string, number>();
  for (const row of rounds ?? []) {
    if (!row.thread_id) continue;
    roundCounts.set(row.thread_id, (roundCounts.get(row.thread_id) ?? 0) + 1);
  }

  return NextResponse.json({
    threads: threads.map((t) => ({
      id: t.id,
      propertyName: t.property_name,
      clientName: (t.clients as unknown as { name: string } | null)?.name ?? null,
      roundCount: roundCounts.get(t.id) ?? 0,
    })),
  });
}
