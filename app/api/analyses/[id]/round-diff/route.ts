import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { diffRound } from "@/lib/round-diff";

/**
 * §2.1.1 — what changed between the version we sent and the version that came
 * back, for one round.
 *
 * Read-only, and it reads no finding and writes none. Whether the property
 * agreed to anything we asked for is §2.1.2's question, and that section is
 * gated.
 */

/** Long enough to read a clause, short enough that a rewritten contract does not fill the wire. */
const MAX_TEXT = 1200;
const MAX_REGIONS = 200;

const clip = (s: string) => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT)}…`);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { id } = await params;
  const admin = createAdminClient();

  const { data: analysis } = await admin
    .from("analyses")
    .select("id, associate_id")
    .eq("id", id)
    .maybeSingle();

  if (!analysis) return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  if (analysis.associate_id !== associate.id && !associate.is_admin) {
    return NextResponse.json({ error: "Not authorized to view this analysis." }, { status: 403 });
  }

  const result = await diffRound(admin, id);
  if (!result.ok) return NextResponse.json({ available: false, reason: result.reason });

  const { diff } = result;
  return NextResponse.json({
    available: true,
    baselineRound: diff.baselineRound,
    returnedRound: diff.returnedRound,
    baselineExplanation: diff.baselineExplanation,
    confidence: diff.confidence,
    retained: diff.retained,
    rebased: diff.rebased,
    totalRegions: diff.regions.length,
    regions: diff.regions.slice(0, MAX_REGIONS).map((region) => ({
      kind: region.kind,
      section: region.section,
      baselineSection: region.baselineSection,
      part: region.part,
      cell: region.cell,
      authors: region.authors,
      was: clip(region.baselineText),
      now: clip(region.returnedText),
    })),
  });
}
