"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startDownload } from "@/lib/download";
import { getMarkupReason } from "@/lib/pdf-markup-reason";
import { ORG } from "@/lib/org";

/**
 * One "Export" button over the four export routes, replacing four separate
 * buttons that each grew their own trigger as its feature landed.
 *
 * Each row runs independently. The two routes with a server preflight
 * (tracked-changes DOCX, proposed contract) fetch `?preflight=1` on their own
 * and expand in place if the verdict isn't clean — so one row's refusal never
 * blocks or delays another row's download. Verdict copy and options are
 * carried over unchanged from the components this replaces.
 */

type ExportKey = "memo" | "markup" | "redline" | "clean";
type Outcome = "clean" | "partial" | "fallback";

interface RedlineUnapplied {
  clause_type: string;
  severity: string;
  quoted_text: string | null;
  reason: string;
  explanation: string;
}

interface RedlinePreflight {
  outcome: Outcome;
  appliedCount: number;
  unapplied: RedlineUnapplied[];
  fallbackReason: string | null;
  markupPdfUrl: string;
}

interface CleanUnplaced {
  clause_type: string;
  reason: string;
}

interface CleanPreflight {
  outcome: Outcome;
  appliedCount: number;
  additions: { clause_type: string }[];
  unplaced: CleanUnplaced[];
  problems: string[];
  markupPdfUrl: string;
}

type RowStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "downloaded" }
  | { kind: "error"; message: string }
  | { kind: "downgrade" }
  | { kind: "redline"; verdict: RedlinePreflight }
  | { kind: "clean"; verdict: CleanPreflight };

const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function redlineUnavailableReason(
  sourceFormat: "pdf" | "docx" | "doc",
  intakeRoute: "docx_native" | "pdf" | null
): string | null {
  if (sourceFormat !== "docx") {
    return "Not available — this contract was reviewed as a PDF, so there's no Word file to mark up.";
  }
  if (intakeRoute === "pdf") {
    return "Not available — this Word file couldn't be read cleanly enough to edit directly, so it was reviewed as a PDF instead.";
  }
  return null;
}

export function ExportPicker({
  analysisId,
  includedCount,
  sourceFormat,
  intakeRoute,
  intakeHealthReason,
}: {
  analysisId: string;
  includedCount: number;
  sourceFormat: "pdf" | "docx" | "doc";
  intakeRoute: "docx_native" | "pdf" | null;
  intakeHealthReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<ExportKey>>(new Set());
  const [started, setStarted] = useState(false);
  const [statuses, setStatuses] = useState<Record<ExportKey, RowStatus>>({
    memo: { kind: "idle" },
    markup: { kind: "idle" },
    redline: { kind: "idle" },
    clean: { kind: "idle" },
  });

  const memoUrl = `/api/analyses/${analysisId}/export`;
  const markupUrl = `/api/analyses/${analysisId}/export-markup`;
  const redlineUrl = `/api/analyses/${analysisId}/export-redline-docx`;
  const cleanUrl = `/api/analyses/${analysisId}/export-clean-pdf`;

  const redlineUnavailable = redlineUnavailableReason(sourceFormat, intakeRoute);
  const forcedDowngrade = sourceFormat !== "pdf" && intakeRoute !== "docx_native";

  function reset() {
    setSelected(new Set());
    setStarted(false);
    setStatuses({
      memo: { kind: "idle" },
      markup: { kind: "idle" },
      redline: { kind: "idle" },
      clean: { kind: "idle" },
    });
  }

  function toggle(key: ExportKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setStatus(key: ExportKey, status: RowStatus) {
    setStatuses((prev) => ({ ...prev, [key]: status }));
  }

  function runMemo() {
    startDownload(memoUrl);
    setStatus("memo", { kind: "downloaded" });
  }

  function runMarkup() {
    if (forcedDowngrade) {
      setStatus("markup", { kind: "downgrade" });
      return;
    }
    startDownload(markupUrl);
    setStatus("markup", { kind: "downloaded" });
  }

  async function runRedline() {
    setStatus("redline", { kind: "checking" });
    try {
      const res = await fetch(`${redlineUrl}?preflight=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus("redline", { kind: "error", message: body.error ?? "Could not prepare the tracked-changes export." });
        return;
      }
      const verdict: RedlinePreflight = await res.json();
      if (verdict.outcome === "clean") {
        startDownload(redlineUrl);
        setStatus("redline", { kind: "downloaded" });
        return;
      }
      setStatus("redline", { kind: "redline", verdict });
    } catch {
      setStatus("redline", { kind: "error", message: "Could not reach the server." });
    }
  }

  async function runClean() {
    setStatus("clean", { kind: "checking" });
    try {
      const res = await fetch(`${cleanUrl}?preflight=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus("clean", { kind: "error", message: body.error ?? "Could not prepare the proposed contract." });
        return;
      }
      const verdict: CleanPreflight = await res.json();
      if (verdict.outcome === "clean") {
        startDownload(cleanUrl);
        setStatus("clean", { kind: "downloaded" });
        return;
      }
      setStatus("clean", { kind: "clean", verdict });
    } catch {
      setStatus("clean", { kind: "error", message: "Could not reach the server." });
    }
  }

  function handleExport() {
    if (selected.size === 0) return;
    setStarted(true);
    if (selected.has("memo")) runMemo();
    if (selected.has("markup")) runMarkup();
    if (selected.has("redline")) runRedline();
    if (selected.has("clean")) runClean();
  }

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="shrink-0"
      >
        Export
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Export</h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Pick one or more files to export.</p>

            <div className="mt-4 space-y-3">
              {/* Memo */}
              <div className="rounded border border-[var(--border)] p-3">
                <label
                  htmlFor="export-memo"
                  aria-label="Requested-revisions memo (PDF)"
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    id="export-memo"
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has("memo")}
                    disabled={started}
                    onChange={() => toggle("memo")}
                  />
                  <span>
                    <span className="block text-xs font-medium text-[var(--text-primary)]">
                      Requested-revisions memo (PDF)
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      Findings and {ORG.shortName}&apos;s rationale, for internal review — not for the property. {includedCount}{" "}
                      finding{includedCount === 1 ? "" : "s"} included.
                    </span>
                  </span>
                </label>
                {statuses.memo.kind === "downloaded" && (
                  <p className="mt-2 text-xs text-[var(--severity-low,#166534)]">Downloaded.</p>
                )}
              </div>

              {/* Marked-up PDF */}
              <div className="rounded border border-[var(--border)] p-3">
                <label
                  htmlFor="export-markup"
                  aria-label="Marked-up PDF"
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    id="export-markup"
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has("markup")}
                    disabled={started}
                    onChange={() => toggle("markup")}
                  />
                  <span>
                    <span className="block text-xs font-medium text-[var(--text-primary)]">Marked-up PDF</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      Redlines as PDF comments and strikeouts, for a property that can&apos;t work in Word.
                    </span>
                  </span>
                </label>
                {statuses.markup.kind === "downgrade" && (
                  <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
                    <p className="text-xs text-[var(--text-primary)] font-medium">
                      This document is getting a PDF markup, not tracked changes
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {getMarkupReason({ sourceFormat, intakeHealthReason })}
                    </p>
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setStatus("markup", { kind: "idle" })}>
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          startDownload(markupUrl);
                          setStatus("markup", { kind: "downloaded" });
                        }}
                      >
                        Download marked-up PDF
                      </Button>
                    </div>
                  </div>
                )}
                {statuses.markup.kind === "downloaded" && (
                  <p className="mt-2 text-xs text-[var(--severity-low,#166534)]">Downloaded.</p>
                )}
              </div>

              {/* Tracked-changes DOCX */}
              <div className="rounded border border-[var(--border)] p-3">
                <label
                  htmlFor="export-redline"
                  aria-label="Tracked-changes DOCX"
                  className={`flex items-start gap-2 ${redlineUnavailable ? "" : "cursor-pointer"}`}
                >
                  <input
                    id="export-redline"
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has("redline")}
                    disabled={started || !!redlineUnavailable}
                    onChange={() => toggle("redline")}
                  />
                  <span>
                    <span className="block text-xs font-medium text-[var(--text-primary)]">Tracked-changes DOCX</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {redlineUnavailable ?? "Redlines as Word tracked changes, for a property that will negotiate in the document."}
                    </span>
                  </span>
                </label>
                {statuses.redline.kind === "checking" && (
                  <p className="mt-2 text-xs text-[var(--text-muted)]">Checking...</p>
                )}
                {statuses.redline.kind === "error" && (
                  <p className="mt-2 text-xs text-[var(--severity-high)]">{statuses.redline.message}</p>
                )}
                {statuses.redline.kind === "downloaded" && (
                  <p className="mt-2 text-xs text-[var(--severity-low,#166534)]">Downloaded.</p>
                )}
                {statuses.redline.kind === "redline" && (
                  <RedlineVerdictRow
                    verdict={statuses.redline.verdict}
                    onSkip={() => setStatus("redline", { kind: "idle" })}
                    onDownload={() => {
                      startDownload(redlineUrl);
                      setStatus("redline", { kind: "downloaded" });
                    }}
                    onDownloadFallback={(url) => {
                      startDownload(url);
                      setStatus("redline", { kind: "downloaded" });
                    }}
                  />
                )}
              </div>

              {/* Proposed contract */}
              <div className="rounded border border-[var(--border)] p-3">
                <label
                  htmlFor="export-clean"
                  aria-label="Proposed contract (clean copy)"
                  className="flex items-start gap-2 cursor-pointer"
                >
                  <input
                    id="export-clean"
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.has("clean")}
                    disabled={started}
                    onChange={() => toggle("clean")}
                  />
                  <span>
                    <span className="block text-xs font-medium text-[var(--text-primary)]">
                      Proposed contract (clean copy)
                    </span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      The contract as it would read if every accepted change applied, for review or to send as a
                      clean attachment.
                    </span>
                  </span>
                </label>
                {statuses.clean.kind === "checking" && (
                  <p className="mt-2 text-xs text-[var(--text-muted)]">Checking...</p>
                )}
                {statuses.clean.kind === "error" && (
                  <p className="mt-2 text-xs text-[var(--severity-high)]">{statuses.clean.message}</p>
                )}
                {statuses.clean.kind === "downloaded" && (
                  <p className="mt-2 text-xs text-[var(--severity-low,#166534)]">Downloaded.</p>
                )}
                {statuses.clean.kind === "clean" && (
                  <CleanVerdictRow
                    verdict={statuses.clean.verdict}
                    onSkip={() => setStatus("clean", { kind: "idle" })}
                    onDownload={() => {
                      startDownload(cleanUrl);
                      setStatus("clean", { kind: "downloaded" });
                    }}
                    onDownloadFallback={(url) => {
                      startDownload(url);
                      setStatus("clean", { kind: "downloaded" });
                    }}
                  />
                )}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                {started ? "Close" : "Cancel"}
              </Button>
              {!started && (
                <Button size="sm" onClick={handleExport} disabled={selected.size === 0}>
                  Export selected ({selected.size})
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RedlineVerdictRow({
  verdict,
  onSkip,
  onDownload,
  onDownloadFallback,
}: {
  verdict: RedlinePreflight;
  onSkip: () => void;
  onDownload: () => void;
  onDownloadFallback: (url: string) => void;
}) {
  if (verdict.outcome === "fallback") {
    return (
      <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
        <p className="text-xs font-medium text-[var(--text-primary)]">
          The Word file could not be produced safely
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Marking up this contract produced a file that failed its checks, so it was discarded rather than sent to
          you. Nothing about the original document has changed.
        </p>
        {verdict.fallbackReason && (
          <p className="mt-1 rounded bg-white p-2 text-xs text-[var(--text-muted)]">{verdict.fallbackReason}</p>
        )}
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          The marked-up PDF carries the same findings and is safe to send instead.
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
          <Button size="sm" onClick={() => onDownloadFallback(verdict.markupPdfUrl)}>
            Download marked-up PDF
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
      <p className="text-xs font-medium text-[var(--text-primary)]">
        {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} marked up. {verdict.unapplied.length}{" "}
        could not be.
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        The file is safe to send. These items are not in the markup, so raise them another way.
      </p>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {verdict.unapplied.map((u, i) => (
          <li key={i} className="rounded border border-[var(--border)] bg-white p-2">
            <p className="text-xs font-medium text-[var(--text-primary)]">
              {titleCase(u.clause_type)}
              <span className="ml-2 font-normal text-[var(--text-muted)]">{u.severity}</span>
            </p>
            {u.quoted_text && <p className="mt-1 text-xs italic text-[var(--text-secondary)]">“{u.quoted_text}”</p>}
            <p className="mt-1 text-xs text-[var(--text-muted)]">{u.explanation}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip
        </Button>
        <Button size="sm" onClick={onDownload}>
          Download anyway
        </Button>
      </div>
    </div>
  );
}

function CleanVerdictRow({
  verdict,
  onSkip,
  onDownload,
  onDownloadFallback,
}: {
  verdict: CleanPreflight;
  onSkip: () => void;
  onDownload: () => void;
  onDownloadFallback: (url: string) => void;
}) {
  if (verdict.outcome === "fallback") {
    return (
      <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
        <p className="text-xs font-medium text-[var(--text-primary)]">
          The proposed contract could not be produced safely
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Rebuilding this contract produced a document that failed its content check, so it was discarded rather
          than sent to you. A clean copy that quietly omits text reads as finished, which is worse than not having
          one.
        </p>
        <ul className="mt-1 space-y-1">
          {verdict.problems.map((p, i) => (
            <li key={i} className="rounded bg-white p-2 text-xs text-[var(--text-muted)]">
              {p}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          The marked-up PDF carries the same changes and is safe to send instead.
        </p>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
          <Button size="sm" onClick={() => onDownloadFallback(verdict.markupPdfUrl)}>
            Download marked-up PDF
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
      <p className="text-xs font-medium text-[var(--text-primary)]">
        {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} applied. {verdict.unplaced.length} could
        not be placed.
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        The contract below carries its original wording for these items, and lists them with the proposed language
        at the end of the document.
      </p>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {verdict.unplaced.map((u, i) => (
          <li key={i} className="rounded border border-[var(--border)] bg-white p-2">
            <p className="text-xs font-medium text-[var(--text-primary)]">{titleCase(u.clause_type)}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{u.reason}</p>
          </li>
        ))}
      </ul>
      {verdict.additions.length > 0 && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {verdict.additions.length} new clause{verdict.additions.length === 1 ? " is" : "s are"} added at the end,
          under their own heading.
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip
        </Button>
        <Button size="sm" onClick={onDownload}>
          Download
        </Button>
      </div>
    </div>
  );
}
