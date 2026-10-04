"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import FindingCard, { SEVERITY_STYLE, type Finding } from "./finding-card";
import FindingsOverviewBar from "./findings-overview-bar";
import DocumentNotes, { noteCount } from "./document-notes";
import PdfViewer from "./pdf-viewer";
import DocxPreview from "./docx-preview";
import { ResizableSplit } from "./resizable-split";
import type { HighlightRect } from "@/lib/locate-text";
import { compareFindings, computeFindingsOverview, findingCategory } from "@/lib/findings-overview";
import type { Category } from "@/lib/standards/types";
import { CATEGORY_STYLE } from "@/components/category-style";
import { ExportPicker } from "@/components/export-picker";
import { EmailPicker } from "@/components/email-picker";
import { AiClauseReview } from "@/components/ai-clause-review";
import { getMarkupReason } from "@/lib/pdf-markup-reason";
import { isStalledRun, stoppedAtAiUseCheck } from "@/lib/analysis-status";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Body, Meta, Title } from "@/components/ui/typography";
import type { DocumentNote } from "@/lib/document-notes";
import { ORG } from "@/lib/org";

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
  ai_clause_scan_result: { matches: AiUseMatch[]; decision?: string | null } | null;
  ai_clause_acknowledged_at: string | null;
  thread_id: string | null;
  round_number: number | null;
  propertyName: string | null;
  document_notes: unknown;
  /** The app's own arithmetic checks on the contract. */
  document_checks?: DocumentNote[];
  /** The earlier review these findings were copied from, when the same file was uploaded again. */
  copiedFrom?: { id: string; completed_at: string | null } | null;
}

function shortDate(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "an earlier date";
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
      <Meta as="p" className="text-[var(--text-muted)] mt-2">
        Uses the contract already uploaded. No re-upload needed.
      </Meta>
      {error && (
        <Meta as="p" role="alert" className="text-[var(--severity-high)] mt-2">
          {error}
        </Meta>
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
  const [freshError, setFreshError] = useState("");
  const [confirmingFresh, setConfirmingFresh] = useState(false);
  const [startingFresh, setStartingFresh] = useState(false);
  const [hiddenCategories, setHiddenCategories] = useState<Set<Category>>(new Set());
  const [hideDecided, setHideDecided] = useState(false);
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

  const sortedFindings = useMemo(() => {
    if (!data) return [];
    return [...data.findings].sort(compareFindings);
  }, [data]);

  const visibleFindings = useMemo(
    () => sortedFindings.filter((f) => !hiddenCategories.has(findingCategory(f)) && !(hideDecided && f.current_action)),
    [sortedFindings, hiddenCategories, hideDecided]
  );

  const handleSelectFinding = useCallback(
    async (finding: Finding) => {
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
    },
    [data?.intake_route, highlightCache]
  );

  // Navigation only, per the user's call — no key takes an action, so a stray
  // keypress can't accept or dismiss the wrong finding. Ignored while typing
  // in a finding's own edit/dismiss controls.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      if (visibleFindings.length === 0) return;
      e.preventDefault();

      const currentIndex = visibleFindings.findIndex((f) => f.id === selectedFindingId);
      const nextIndex =
        currentIndex === -1
          ? 0
          : e.key === "ArrowDown"
            ? Math.min(currentIndex + 1, visibleFindings.length - 1)
            : Math.max(currentIndex - 1, 0);

      const next = visibleFindings[nextIndex];
      if (next.id === selectedFindingId) return;
      handleSelectFinding(next);
      document.getElementById(`finding-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleFindings, selectedFindingId, handleSelectFinding]);

  async function runFreshReview() {
    setFreshError("");
    setStartingFresh(true);
    try {
      const res = await fetch(`/api/analyses/${params.id}/fresh-review`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFreshError(body.error || "The new review couldn't start. Try again in a moment.");
        return;
      }
      window.location.reload();
    } catch {
      setFreshError("The new review couldn't start. Check your connection and try again.");
    } finally {
      setStartingFresh(false);
    }
  }

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

  function handleActionRecorded(findingId: string, action: Finding["current_action"]) {
    // An edit changes what the redline would do, which the API works out.
    if (action?.action === "edit") pollNow.current();
    setData((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) => (f.id === findingId ? { ...f, current_action: action } : f)),
          }
        : prev
    );

    // Advances to the next undecided finding still visible under the active
    // filter, so deciding a run of findings doesn't strand the associate on a
    // now-decided card. Never wraps — landing back at the top of a long list
    // a moment after finishing it would be disorienting, not helpful.
    if (findingId !== selectedFindingId) return;
    const decidedIndex = visibleFindings.findIndex((f) => f.id === findingId);
    if (decidedIndex === -1) return;
    const next = visibleFindings.slice(decidedIndex + 1).find((f) => !f.current_action);
    if (!next) return;
    handleSelectFinding(next);
    document.getElementById(`finding-${next.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function toggleCategory(category: Category) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function toggleHideDecided() {
    setHideDecided((prev) => !prev);
  }

  if (loadError) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center">
          <Body as="p" className="text-[var(--severity-high)] mb-2">
            {loadError}
          </Body>
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
        <Body as="p" className="text-[var(--text-secondary)]">
          Loading...
        </Body>
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
          <Body as="p" className="font-medium text-[var(--text-primary)] mb-1">
            {stalled ? "This run has stopped responding" : data.status === "queued" ? "Queued..." : "Analyzing " + data.filename}
          </Body>
          <Body as="p" className="text-[var(--text-secondary)] mb-3">
            {stalled
              ? `Nothing has come back in ${Math.floor(elapsedSeconds / 60)} minutes, which usually means the connection dropped mid-run. Your contract is still saved, so start it again from here.`
              : `Usually 2-5 minutes, longer if the model needs a retry or the contract is unusually long. (${elapsedSeconds}s elapsed)`}
          </Body>
          {stalled ? (
            <RetryControls onRetry={retryAnalysis} retrying={retrying} error={retryError} />
          ) : (
            <div className="h-1.5 w-64 mx-auto rounded bg-[var(--border)] overflow-hidden">
              <div className="h-full w-1/3 bg-[var(--cd-navy)] animate-pulse" />
            </div>
          )}
          {offline && !stalled && (
            <Meta as="p" className="text-[var(--text-muted)] mt-3">
              Can&apos;t reach the server right now, so it&apos;s still checking. The analysis keeps running without
              this page.
            </Meta>
          )}
        </div>
      </div>
    );
  }

  if (data.status === "failed" && stoppedAtAiUseCheck(data)) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Body as="p" className="font-medium text-[var(--text-primary)] mb-1">
            Stopped at the AI-use check
          </Body>
          <Body as="p" className="text-[var(--text-secondary)] mb-4">
            An associate read the matched language and chose not to proceed, so the contract was not sent for review.
          </Body>
          <Link href="/upload" className="text-sm text-[var(--text-secondary)] underline">
            Upload a different file
          </Link>
        </div>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <Body as="p" className="font-medium text-[var(--severity-high)] mb-1">
            Analysis failed
          </Body>
          <Body as="p" className="text-[var(--text-secondary)] mb-4">
            {data.error || "Something went wrong processing this contract."}
          </Body>
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

  const overview = computeFindingsOverview(sortedFindings);
  const checks = data.document_checks ?? [];
  const notesInOther = noteCount(data.document_notes, checks);
  // Notes sit in the Other bucket with the findings outside CD's standards, so its count includes them.
  const bucketOverview = {
    ...overview,
    byCategory: { ...overview.byCategory, other: overview.byCategory.other + notesInOther },
  };
  const businessFindings = visibleFindings.filter((f) => findingCategory(f) === "business");
  const legalFindings = visibleFindings.filter((f) => findingCategory(f) === "legal");
  const otherFindings = visibleFindings.filter((f) => findingCategory(f) === "other");
  const showOther = !hiddenCategories.has("other") && (otherFindings.length > 0 || notesInOther > 0);
  const card = (f: Finding) => (
    <FindingCard
      key={f.id}
      finding={f}
      focused={f.id === selectedFindingId}
      onActionRecorded={handleActionRecorded}
      onSelectFinding={handleSelectFinding}
      locateMode={data.intake_route === "docx_native" ? "docx" : "pdf"}
    />
  );

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-[var(--border)] bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <Link href="/" className="text-xs text-[var(--text-muted)] hover:text-[var(--cd-navy)]">
            ← Back
          </Link>
          <Title className="text-[var(--text-primary)] truncate">{data.filename}</Title>
          <div className="flex items-center gap-1.5 mt-0.5">
            {data.thread_id && (
              <>
                <Link href={`/threads/${data.thread_id}`} className="text-xs text-[var(--cd-navy)] hover:underline">
                  Round {data.round_number} of {data.propertyName ?? "this negotiation"}
                </Link>
                <span className="text-[var(--border-strong)]" aria-hidden="true">
                  ·
                </span>
              </>
            )}
            <Meta as="span" className="text-[var(--text-muted)]">
              {sortedFindings.length} finding{sortedFindings.length === 1 ? "" : "s"} · not legal advice, review each
              one
            </Meta>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportPicker
            analysisId={data.id}
            includedCount={overview.includedCount}
            undecidedCount={overview.undecidedCount}
            sourceFormat={data.source_format}
            intakeRoute={data.intake_route}
            intakeHealthReason={data.intake_health?.reason ?? null}
          />
          <EmailPicker analysisId={data.id} />
        </div>
      </div>

      {data.copiedFrom && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--cd-blue-pale)] px-6 py-2 shrink-0">
          <Meta as="p" className="text-[var(--cd-navy)]">
            Copied from{" "}
            <Link href={`/analyses/${data.copiedFrom.id}`} className="underline">
              your review of {shortDate(data.copiedFrom.completed_at)}
            </Link>
            , because this is the same file. No new review was run, and none of this month&apos;s reviews was used.
          </Meta>
          <Button size="sm" variant="secondary" onClick={() => setConfirmingFresh(true)} className="shrink-0 bg-white">
            Run a new review
          </Button>
          <DialogShell
            open={confirmingFresh}
            onClose={() => setConfirmingFresh(false)}
            title="Run a new review?"
            maxWidth="md"
            dismissible={!startingFresh}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirmingFresh(false)} disabled={startingFresh}>
                  Keep the copy
                </Button>
                <Button onClick={runFreshReview} loading={startingFresh} loadingText="Starting...">
                  Run a new review
                </Button>
              </>
            }
          >
            <Body as="p">
              A new review uses one of this month&apos;s reviews. It replaces the copied findings, and your decisions on
              them, with whatever the new review finds.
            </Body>
            {freshError && (
              <Body as="p" className="mt-2 text-[var(--severity-high)]">
                {freshError}
              </Body>
            )}
          </DialogShell>
        </div>
      )}

      {/* Below lg the panes stack, each with its own scroll, so the findings stay reachable under a long contract. From lg the divider between them can be dragged. */}
      <ResizableSplit
        contract={
          <div className="h-[45vh] shrink-0 border-b lg:h-auto lg:shrink lg:w-[calc(100%-var(--findings-width))] lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--surface-muted)] flex flex-col">
            {data.source_format !== "pdf" && data.intake_route !== "docx_native" && (
              <Meta as="div" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] px-4 py-2 shrink-0">
                {getMarkupReason({ sourceFormat: data.source_format, intakeHealthReason: data.intake_health?.reason ?? null })}{" "}
                Converted from {data.source_format.toUpperCase()} for review, text only. Original formatting (tables,
                letterhead, styling) isn&apos;t preserved here.
              </Meta>
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
              <Body as="p" className="p-6 text-[var(--text-secondary)]">
                Document preview unavailable.
              </Body>
            )}
          </div>
        }
        findings={
          <div className="flex-1 min-h-0 lg:w-[var(--findings-width)] overflow-y-auto bg-[var(--surface-muted)]">
            {sortedFindings.length + notesInOther > 0 && (
              <div className="sticky top-0 z-10 bg-[var(--surface-muted)] px-4 py-3 border-b border-[var(--border)]">
                <FindingsOverviewBar
                  overview={bucketOverview}
                  hiddenCategories={hiddenCategories}
                  onToggleCategory={toggleCategory}
                  hideDecided={hideDecided}
                  onToggleHideDecided={toggleHideDecided}
                />
              </div>
            )}
            <div className="px-4 py-4 space-y-3">
              {sortedFindings.length + notesInOther === 0 ? (
                <Body as="p" className="text-[var(--text-secondary)]">
                  No findings. Nothing flagged against the standards library.
                </Body>
              ) : businessFindings.length + legalFindings.length === 0 && !showOther ? (
                <Body as="p" className="text-[var(--text-secondary)]">
                  No findings match this filter.
                </Body>
              ) : null}
              {businessFindings.length > 0 && (
                <section aria-label="Business" className="space-y-3">
                  <SectionHeading category="business">proposed changes to the contract</SectionHeading>
                  {businessFindings.map(card)}
                </section>
              )}
              {legalFindings.length > 0 && (
                <section aria-label="Legal" className="space-y-3 pt-2">
                  <SectionHeading category="legal">for the client&apos;s counsel</SectionHeading>
                  <Meta as="p" className="text-[var(--text-muted)] -mt-2">
                    {ORG.shortName} doesn&apos;t give legal advice, so these explain a risk and propose no wording. Flag one
                    to list it in the client memo and email, for the client to raise with their counsel.
                  </Meta>
                  {legalFindings.map(card)}
                </section>
              )}
              {showOther && (
                <section aria-label="Other" className="space-y-3 pt-2">
                  <SectionHeading category="other">
                    points raised without wording, and notes on the document
                  </SectionHeading>
                  {otherFindings.length > 0 && (
                    <Meta as="p" className="text-[var(--text-muted)] -mt-2">
                      These points carry no proposed wording. Accepting one puts it in the memo; use Add wording to put a
                      change in the redline.
                    </Meta>
                  )}
                  {otherFindings.map(card)}
                  <DocumentNotes notes={data.document_notes} checks={checks} />
                </section>
              )}
            </div>
          </div>
        }
      />
    </div>
  );
}

function SectionHeading({ category, children }: { category: Category; children: React.ReactNode }) {
  const style = CATEGORY_STYLE[category];
  return (
    <Meta as="h2" className="text-[var(--text-secondary)]">
      <span className="font-semibold uppercase tracking-wide" style={{ color: style.textColor }}>
        {style.name}
      </span>
      {" · "}
      {children}
    </Meta>
  );
}
