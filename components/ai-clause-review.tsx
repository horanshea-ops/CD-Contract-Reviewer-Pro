"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Body, ReadingText, Subtitle } from "@/components/ui/typography";

interface AiUseMatch {
  term: string;
  excerpt: string;
  matchStart: number;
  matchLength: number;
}

function Highlighted({ match }: { match: AiUseMatch }) {
  const before = match.excerpt.slice(0, match.matchStart);
  const hit = match.excerpt.slice(match.matchStart, match.matchStart + match.matchLength);
  const after = match.excerpt.slice(match.matchStart + match.matchLength);
  return (
    <ReadingText
      as="p"
      className="text-[var(--text-muted)] border-l-2 border-[var(--border)] pl-2"
    >
      {before}
      <mark className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] font-medium px-0.5">{hit}</mark>
      {after}
    </ReadingText>
  );
}

/**
 * §1.10.3's gate: the associate sees the exact matched language before
 * deciding whether to proceed. Rendered in place of the usual "analyzing..."
 * spinner while an analysis is blocked on this decision.
 */
export function AiClauseReview({
  analysisId,
  matches,
  onDecided,
}: {
  analysisId: string;
  matches: AiUseMatch[];
  onDecided: (result: { decision: "proceed" | "abort"; error: string | null }) => void;
}) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState<"proceed" | "abort" | null>(null);

  async function decide(decision: "proceed" | "abort") {
    setSubmitting(decision);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/ai-clause-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Could not record that decision.", "error");
        setSubmitting(null);
        return;
      }
      onDecided({ decision, error: body.error ?? null });
    } catch {
      showToast("Could not reach the server.", "error");
      setSubmitting(null);
    }
  }

  return (
    <div className="h-full flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <Subtitle className="text-[var(--text-primary)] mb-1">This contract may restrict AI-assisted review</Subtitle>
        <Body as="p" className="text-[var(--text-secondary)] mb-4">
          The document wasn&apos;t sent anywhere. This was found by a local scan. Review the language below and
          decide whether to proceed with analysis.
        </Body>
        <ul className="space-y-3 max-h-72 overflow-y-auto mb-4">
          {matches.map((m, i) => (
            <li key={i} className="rounded border border-[var(--border)] p-3 bg-[var(--surface-muted)]">
              <Highlighted match={m} />
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => decide("abort")}
            loading={submitting === "abort"}
            loadingText="Stopping..."
            disabled={submitting !== null}
          >
            Don&apos;t proceed
          </Button>
          <Button
            size="sm"
            onClick={() => decide("proceed")}
            loading={submitting === "proceed"}
            loadingText="Resuming..."
            disabled={submitting !== null}
          >
            Proceed with analysis
          </Button>
        </div>
      </div>
    </div>
  );
}
