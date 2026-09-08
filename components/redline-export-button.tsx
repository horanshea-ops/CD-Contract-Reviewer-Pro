"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Tracked-changes export, gated on the §1.6 oracle.
 *
 * §1.6.4 requires the list of what could not be applied to be visible *before*
 * the download, which a plain link cannot do. So the click asks the route for a
 * verdict first, and only a clean result downloads straight away.
 */

type Outcome = "clean" | "partial" | "fallback";

interface UnappliedFinding {
  clause_type: string;
  severity: string;
  quoted_text: string | null;
  reason: string;
  explanation: string;
}

interface Preflight {
  outcome: Outcome;
  appliedCount: number;
  unapplied: UnappliedFinding[];
  fallbackReason: string | null;
  markupPdfUrl: string;
}

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * The route answers with a file attachment, not a page, so this is a download
 * rather than a navigation and the router has no part in it.
 */
function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function RedlineExportButton({ analysisId }: { analysisId: string }) {
  const { showToast } = useToast();
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<Preflight | null>(null);

  const downloadUrl = `/api/analyses/${analysisId}/export-redline-docx`;

  async function check() {
    setChecking(true);
    try {
      const res = await fetch(`${downloadUrl}?preflight=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast(body.error ?? "Could not prepare the tracked-changes export.", "error");
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
      <Button variant="secondary" size="sm" onClick={check} loading={checking} loadingText="Checking..." className="shrink-0">
        Export tracked-changes DOCX
      </Button>

      {verdict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg">
            {verdict.outcome === "partial" ? (
              <>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} marked up.{" "}
                  {verdict.unapplied.length} could not be.
                </h2>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  The file is safe to send. These items are not in the markup, so raise them another way.
                </p>
                <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                  {verdict.unapplied.map((u, i) => (
                    <li key={i} className="rounded border border-[var(--border)] p-2">
                      <p className="text-xs font-medium text-[var(--text-primary)]">
                        {titleCase(u.clause_type)}
                        <span className="ml-2 font-normal text-[var(--text-muted)]">{u.severity}</span>
                      </p>
                      {u.quoted_text && (
                        <p className="mt-1 text-xs italic text-[var(--text-secondary)]">“{u.quoted_text}”</p>
                      )}
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{u.explanation}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setVerdict(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" href={downloadUrl} onClick={() => setVerdict(null)}>
                    Download anyway
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  The Word file could not be produced safely
                </h2>
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  Marking up this contract produced a file that failed its checks, so it was discarded rather
                  than sent to you. Nothing about the original document has changed.
                </p>
                {verdict.fallbackReason && (
                  <p className="mt-2 rounded bg-[var(--surface-muted)] p-2 text-xs text-[var(--text-muted)]">
                    {verdict.fallbackReason}
                  </p>
                )}
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  The marked-up PDF carries the same findings and is safe to send instead.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setVerdict(null)}>
                    Close
                  </Button>
                  <Button size="sm" href={verdict.markupPdfUrl} onClick={() => setVerdict(null)}>
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
