import { NextResponse } from "next/server";
import { getCurrentAssociate } from "@/lib/current-associate";
import { analyticsEnabled, loadAnalyticsData } from "@/lib/analytics/source";
import { renderTermSheetPdf } from "@/lib/analytics/term-sheet-pdf";

/** A contract's term sheet. Any signed-in associate may open any contract's, because it names no associate. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!analyticsEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const associate = await getCurrentAssociate();
  if (!associate) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await params;
  const { contracts } = await loadAnalyticsData();
  const record = contracts.find((c) => c.id === id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await renderTermSheetPdf(record);
  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="term-sheet-${record.id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
