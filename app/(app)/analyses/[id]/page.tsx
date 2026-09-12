"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import FindingCard, { SEVERITY_STYLE, type Finding } from "./finding-card";
import PdfViewer from "./pdf-viewer";
import DocxPreview from "./docx-preview";
import type { HighlightRect } from "@/lib/locate-text";
import { ExportPicker } from "@/components/export-picker";
import { EmailPicker } from "@/components/email-picker";
import { AiClauseReview } from "@/components/ai-clause-review";
import { getMarkupReason } from "@/lib/pdf-markup-reason";
import { isStalledRun } from "@/lib/analysis-status";
import { Button } from "@/components/ui/button";

interface AiUseMatch {
  term: string;
  excerpt: string;
  matchStart: number;
  matchLength: number;
}

interface AnalysisResponse {
  id: string;
  filename: string;
  source_format: "pdf" | "docx" | "doc";
  status: "queued" | "processing" | "complete" | "failed";
  error: string | null;
  created_at: string;
  started_at: string | null;
  model_id: string | null;
  library_version: string | null;
  documentUrl: string | null;
  findings: Finding[];
  error_message?: string;
  intake_route: "docx_native" | "pdf" | null;
  intake_health: { reason: string | null } | null;
  had_existing_revisions: boolean | null;
  existing_revision_authors: string[] | null;
  existing_revision_count: number | null;
  ai_clause_scan_result: { matches: AiUseMatch[] } | null;
  ai_clause_acknowledged_at: string | null;
  thread_id: string | null;
  round_number: number | null;
  propertyName: string | null;
}

const POLL_INTERVAL_MS = 2000;
const OFFLINE_POLL_INTERVAL_MS = 5000;

function RetryControls({
  onRetry,
  retrying,
  error,
}: {
  onRetry: () => void;
  retrying: boolean;
  error: string;
}) {
  return (
    <>
      <Button size="sm" onClick={onRetry} loading={retrying} loadingText="Restarting...">
        Run the analysis again
      </Button>
      <p className="text-xs text-[var(--text-muted)] mt-2">Uses the contract already uploaded. No re-upload needed.</p>
      {error && (
        <p role="alert" className="text-xs text-[var(--severity-high)] mt-2">
          {error}
        </p>
      )}
    </>
  );
}

export default function AnalysisPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [highlightCache, setHighlightCache] = useState<Record<string, HighlightRect[] | null>>({});
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${params.id}`);
        const body = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setLoadError(body.error || "Could not load this analysis.");
          return;
        }

        setOffline(false);
        setData(body);

        if (body.status === "queued" || body.status === "processing") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        // A dropped connection is not the end of the run. The analysis keeps
        // going on the server, so keep asking rather than stranding the screen
        // on an error it can recover from by itself.
        if (cancelled) return;
        setOffline(true);
        timer = setTimeout(poll, OFFLINE_POLL_INTERVAL_MS);
      }
    }

    pollNow.current = () => {
      clearTimeout(timer);
      poll();
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id]);

  // Counted from when the run started, not from when this screen opened, so a
  // reload doesn't reset the clock an associate is judging the wait by.
  useEffect(() => {
    if (!data || data.status === "complete" || data.status === "failed") return;
    const since = Date.parse(data.started_at || data.created_at);
    if (Number.isNaN(since)) return;
    const tick = () => setElapsedSeconds(Math.max(0, Math.round((Date.now() - since) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data]);

  async function retryAnalysis() {
    setRetrying(true);
    setRetryError("");
    try {
      const res = await fetch(`/api/analyses/${params.id}/retry`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRetryError(body.error || "Could not restart this analysis.");
        return;
      }
      setData((prev) => (prev ? { ...prev, status: "queued", error: null, started_at: null, findings: [] } : prev));
      pollNow.current();
    } catch {
      setRetryError("Could not reach the server. Check your connection and try again.");
    } finally {
      setRetrying(false);
    }
  }

  async function handleSelectFinding(finding: Finding) {
    setSelectedFindingId(finding.id);
    if (data?.intake_route === "docx_native") {
      // DocxPreview resolves its own highlight from data it already has —
      // no PDF page/coordinate concept applies here.
      return;
    }
    setActivePage(finding.location_page);
    if (finding.location_page == null || finding.id in highlightCache) return;
    try {
      const res = await fetch(`/api/findings/${finding.id}/highlight`);
      const body = await res.json();
      setHighlightCache((prev) => ({ ...prev, [finding.id]: res.ok ? (body.rects ?? null) : null }));
    } catch {
      setHighlightCache((prev) => ({ ...prev, [finding.id]: null }));
    }
  }

  function handleActionRecorded(findingId: string, action: Finding["current_action"]) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) => (f.id === findingId ? { ...f, current_action: action } : f)),
          }
        : prev
    );
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-sm text-[var(--severity-high)] mb-2">{loadError}</p>
          <Link href="/upload" className="text-sm text-[var(--text-secondary)] underline">
            Try uploading again
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">Loading...</p>
      </div>
    );
  }

  if (data.status === "processing" && data.ai_clause_scan_result?.matches?.length && !data.ai_clause_acknowledged_at) {
    return (
      <AiClauseReview
        analysisId={data.id}
        matches={data.ai_clause_scan_result.matches}
        onDecided={({ decision, error }) =>
          setData((prev) =>
            prev
              ? decision === "abort"
                ? { ...prev, status: "failed", error }
                : { ...prev, ai_clause_acknowledged_at: new Date().toISOString() }
              : prev
          )
        }
      />
    );
  }

  if (data.status === "queued" || data.status === "processing") {
    const stalled = isStalledRun(data);

    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
            {stalled ? "This run has stopped responding" : data.status === "queued" ? "Queued..." : "Analyzing " + data.filename}
          </p>
          <p className="text-sm text-[var(--text-secondary)] mb-3">
            {stalled
              ? `Nothing has come back in ${Math.floor(elapsedSeconds / 60)} minutes, which usually means the connection dropped mid-run. Your contract is still saved — start it again from here.`
              : `Usually 1-3 minutes, longer if the model needs a retry or the contract is unusually long. (${elapsedSeconds}s elapsed)`}
          </p>
          {stalled ? (
            <RetryControls onRetry={retryAnalysis} retrying={retrying} error={retryError} />
          ) : (
            <div className="h-1.5 w-64 mx-auto rounded bg-[var(--border)] overflow-hidden">
              <div className="h-full w-1/3 bg-[var(--cd-navy)] animate-pulse" />
            </div>
          )}
          {offline && !stalled && (
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Can&apos;t reach the server right now — still checking. The analysis keeps running without this page.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <p className="text-sm font-medium text-[var(--severity-high)] mb-1">Analysis failed</p>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            {data.error || "Something went wrong processing this contract."}
          </p>
          <RetryControls onRetry={retryAnalysis} retrying={retrying} error={retryError} />
          <p className="mt-3">
            <Link href="/upload" className="text-sm text-[var(--text-secondary)] underline">
              Or upload a different file
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const sortedFindings = [...data.findings].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, note: 3 };
    return order[a.severity] - order[b.severity];
  });

  const includedCount = sortedFindings.filter(
    (f) => f.current_action?.action === "accept" || f.current_action?.action === "edit"
  ).length;
  const undecidedCount = sortedFindings.filter((f) => !f.current_action).length;

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-[var(--border)] bg-white px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--cd-navy)]">
            ← Back
          </Link>
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">{data.filename}</h1>
          {data.thread_id && (
            <Link
              href={`/threads/${data.thread_id}`}
              className="block text-xs text-[var(--cd-navy)] hover:underline mt-0.5"
            >
              Round {data.round_number} of {data.propertyName ?? "this negotiation"}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4">
          <p className="text-xs text-[var(--text-muted)]">
            {sortedFindings.length} finding{sortedFindings.length === 1 ? "" : "s"}
            {undecidedCount > 0 && ` · ${undecidedCount} still need a decision`}
            {" · not legal advice — review each one"}
          </p>
          <ExportPicker
            analysisId={data.id}
            includedCount={includedCount}
            sourceFormat={data.source_format}
            intakeRoute={data.intake_route}
            intakeHealthReason={data.intake_health?.reason ?? null}
          />
          <EmailPicker analysisId={data.id} />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="lg:w-1/2 border-r border-[var(--border)] bg-[var(--surface-muted)] flex flex-col">
          {data.source_format !== "pdf" && data.intake_route !== "docx_native" && (
            <div className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] text-xs px-4 py-2 shrink-0">
              {getMarkupReason({ sourceFormat: data.source_format, intakeHealthReason: data.intake_health?.reason ?? null })}{" "}
              Converted from {data.source_format.toUpperCase()} for review — text only, original formatting
              (tables, letterhead, styling) isn&apos;t preserved here.
            </div>
          )}
          {data.intake_route === "docx_native" ? (
            <DocxPreview
              analysisId={data.id}
              hadExistingRevisions={!!data.had_existing_revisions}
              existingRevisionAuthors={data.existing_revision_authors ?? []}
              existingRevisionCount={data.existing_revision_count ?? 0}
              selectedFinding={sortedFindings.find((f) => f.id === selectedFindingId) ?? null}
              highlightColor={
                SEVERITY_STYLE[sortedFindings.find((f) => f.id === selectedFindingId)?.severity ?? "note"].bg
              }
            />
          ) : data.documentUrl ? (
            <div className="flex-1 min-h-0">
              <PdfViewer
                documentUrl={data.documentUrl}
                activePage={activePage}
                highlightRects={selectedFindingId ? (highlightCache[selectedFindingId] ?? null) : null}
                highlightColor={
                  SEVERITY_STYLE[sortedFindings.find((f) => f.id === selectedFindingId)?.severity ?? "note"].bg
                }
              />
            </div>
          ) : (
            <p className="p-6 text-sm text-[var(--text-secondary)]">Document preview unavailable.</p>
          )}
        </div>

        <div className="lg:w-1/2 overflow-y-auto px-4 py-4 space-y-3 bg-[var(--surface-muted)]">
          {sortedFindings.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              No findings — nothing flagged against the standards library.
            </p>
          ) : (
            sortedFindings.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                onActionRecorded={handleActionRecorded}
                onSelectFinding={handleSelectFinding}
                locateMode={data.intake_route === "docx_native" ? "docx" : "pdf"}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
