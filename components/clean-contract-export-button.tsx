"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { startDownload } from "@/lib/download";

/**
 * §1.7.7 — the contract as it would read if the property agreed.
 *
 * The click asks for a verdict first, the same shape as the tracked-changes
 * button: a clean result downloads straight away, anything else is shown before
 * the file is offered. A document that failed its content check is not offered
 * at all, because it would look finished while missing text.
 */

type Outcome = "clean" | "partial" | "fallback";

interface Preflight {
  outcome: Outcome;
  appliedCount: number;
  additions: { clause_type: string }[];
  unplaced: { clause_type: string; reason: string }[];
  problems: string[];
  markupPdfUrl: string;
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function CleanContractExportButton({ analysisId }: { analysisId: string }) {
  const { showToast } = useToast();
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Preflight | null>(null);

  const downloadUrl = `/api/analyses/${analysisId}/export-clean-pdf`;

  async function check() {
    setChecking(true);
    try {
      const res = await fetch(`${downloadUrl}?preflight=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error ?? "Could not prepare the proposed contract.", "error");
        return;
      }
      const result: Preflight = await res.json();
      if (result.outcome === "clean") {
        startDownload(downloadUrl);
        return;
      }
      setVerdict(result);
    } catch {
      showToast("Could not reach the server.", "error");
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={check} loading={checking} loadingText="Preparing..." className="shrink-0">
        Export proposed contract
      </Button>

      {verdict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg">
            {verdict.outcome === "partial" ? (
              <>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} applied.{" "}
                  {verdict.unplaced.length} could not be placed.
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  The contract below carries its original wording for these items, and lists them with the
                  proposed language at the end of the document.
                </p>
                <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {verdict.unplaced.map((u, i) => (
                    <li key={i} className="rounded border border-[var(--border)] p-2">
                      <p className="text-xs font-medium text-[var(--text-primary)]">{titleCase(u.clause_type)}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{u.reason}</p>
                    </li>
                  ))}
                </ul>
                {verdict.additions.length > 0 && (
                  <p className="mt-3 text-xs text-[var(--text-secondary)]">
                    {verdict.additions.length} new clause{verdict.additions.length === 1 ? " is" : "s are"} added
                    at the end, under their own heading.
                  </p>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setVerdict(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => { startDownload(downloadUrl); setVerdict(null); }}>
                    Download
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  The proposed contract could not be produced safely
                </h2>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  Rebuilding this contract produced a document that failed its content check, so it was
                  discarded rather than sent to you. A clean copy that quietly omits text reads as finished,
                  which is worse than not having one.
                </p>
                <ul className="mt-2 space-y-1">
                  {verdict.problems.map((p, i) => (
                    <li key={i} className="rounded bg-[var(--surface-muted)] p-2 text-xs text-[var(--text-muted)]">
                      {p}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  The marked-up PDF carries the same changes and is safe to send instead.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setVerdict(null)}>
                    Close
                  </Button>
                  <Button size="sm" onClick={() => { startDownload(verdict.markupPdfUrl); setVerdict(null); }}>
                    Download marked-up PDF
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
