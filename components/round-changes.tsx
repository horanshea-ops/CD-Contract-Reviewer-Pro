"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Body, Meta, ReadingText, Subtitle } from "@/components/ui/typography";

/**
 * §2.1.1 — what is different in the document the property sent back.
 *
 * Deliberately plain about what it is not. This lists changes to the text; it
 * does not say whether the property agreed to anything we asked for. Reading a
 * raw diff as "they rejected this" is exactly the mistake §2.1.2 exists to
 * avoid making, and that section is gated, so no word here suggests an outcome.
 */

interface SectionRef {
  number: string | null;
  label: string;
  title: string;
}

interface Region {
  kind: "insert" | "delete" | "replace" | "move";
  section: SectionRef | null;
  baselineSection: SectionRef | null;
  part: string | null;
  cell: { tableIndex: number; cellIndex: number } | null;
  authors: string[];
  was: string;
  now: string;
}

interface RoundDiffResponse {
  available: boolean;
  reason?: string;
  baselineRound?: number;
  returnedRound?: number;
  baselineExplanation?: string;
  confidence?: "high" | "medium" | "low";
  retained?: number;
  rebased?: boolean;
  totalRegions?: number;
  regions?: Region[];
}

const KIND_LABEL: Record<Region["kind"], string> = {
  insert: "Added",
  delete: "Removed",
  replace: "Changed",
  move: "Moved",
};

const CONFIDENCE_NOTE: Record<"high" | "medium" | "low", string> = {
  high: "",
  medium: "Read this as a good guide rather than an exact record.",
  low: "Read this as a rough guide only.",
};

function where(region: Region): string {
  if (region.section) {
    return [region.section.number, region.section.title].filter(Boolean).join(" ");
  }
  if (region.part && region.part !== "document") return region.part;
  return "Not under a numbered clause";
}

function Renumbered({ region }: { region: Region }) {
  const before = region.baselineSection?.number;
  const after = region.section?.number;
  if (!before || !after || before === after) return null;
  return <Meta as="span" className="text-[var(--text-muted)]"> · was clause {before}</Meta>;
}

function Quote({ label, text, tone }: { label: string; text: string; tone: "was" | "now" }) {
  if (!text) return null;
  const styles =
    tone === "was"
      ? "border-[var(--severity-high)] bg-[var(--severity-high-bg)] text-[var(--severity-high)]"
      : "border-[var(--cd-blue)] bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]";

  return (
    <div className="mt-2">
      <Meta as="p" className="text-[var(--text-muted)] uppercase tracking-wide">
        {label}
      </Meta>
      <ReadingText as="p" className={`mt-0.5 border-l-2 pl-2 py-0.5 ${styles}`}>
        {text}
      </ReadingText>
    </div>
  );
}

export function RoundChanges({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<RoundDiffResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/analyses/${analysisId}/round-diff`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: RoundDiffResponse) => live && setData(body))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [analysisId]);

  // Nothing to compare, or the comparison could not be made: say nothing at
  // all rather than showing an empty panel explaining itself.
  if (failed || (data && !data.available)) return null;

  if (!data) {
    return (
      <Card className="mt-6">
        <Meta as="p" className="text-[var(--text-secondary)]">
          Reading both rounds…
        </Meta>
      </Card>
    );
  }

  const regions = data.regions ?? [];
  const hidden = (data.totalRegions ?? 0) - regions.length;

  return (
    <Card padding="none" className="mt-6 overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border)]">
        <Subtitle className="text-[var(--text-primary)]">
          Document changes in round {data.returnedRound}
        </Subtitle>
        <Meta as="p" className="text-[var(--text-secondary)] mt-1">
          Against round {data.baselineRound}. {data.baselineExplanation}
          {data.confidence && CONFIDENCE_NOTE[data.confidence] ? ` ${CONFIDENCE_NOTE[data.confidence]}` : ""}
        </Meta>
        <Meta as="p" className="text-[var(--text-muted)] mt-1">
          This is what moved in the document. It does not say what the property agreed to.
        </Meta>
      </div>

      {data.rebased ? (
        <div className="px-5 py-4">
          <Body as="p" className="text-[var(--severity-high)]">
            Too little of what we sent came back for a change-by-change reading to mean anything.
          </Body>
          <Meta as="p" className="text-[var(--text-secondary)] mt-1">
            This looks like a different draft rather than an edit of the version we sent. Compare the
            two files directly.
          </Meta>
        </div>
      ) : regions.length === 0 ? (
        <div className="px-5 py-4">
          <Body as="p" className="text-[var(--text-primary)]">
            The wording came back unchanged.
          </Body>
        </div>
      ) : (
        <>
          <div className="divide-y divide-[var(--border)]">
            {regions.map((region, i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <Body as="p" className="font-medium text-[var(--text-primary)]">
                    {KIND_LABEL[region.kind]} — {where(region)}
                    <Renumbered region={region} />
                  </Body>
                  {region.authors.length > 0 && (
                    <Meta as="span" className="text-[var(--text-secondary)] shrink-0">
                      {region.authors.join(", ")}
                    </Meta>
                  )}
                </div>
                {region.cell && (
                  <Meta as="p" className="text-[var(--text-muted)] mt-0.5">
                    In table {region.cell.tableIndex + 1}, cell {region.cell.cellIndex + 1}
                  </Meta>
                )}
                <Quote label="We sent" text={region.was} tone="was" />
                <Quote label="Came back" text={region.now} tone="now" />
              </div>
            ))}
          </div>
          {hidden > 0 && (
            <Meta as="p" className="px-5 py-3 text-[var(--text-secondary)] border-t border-[var(--border)]">
              {hidden} further change{hidden === 1 ? "" : "s"} not listed.
            </Meta>
          )}
        </>
      )}
    </Card>
  );
}
