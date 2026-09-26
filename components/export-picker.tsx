"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Body, Meta } from "@/components/ui/typography";
import { downloadFile } from "@/lib/download";
import { getMarkupReason } from "@/lib/pdf-markup-reason";
import { clauseLabel } from "@/lib/format";
import { ORG } from "@/lib/org";

/**
 * One "Export" button over the export routes, replacing four separate buttons
 * that each grew their own trigger as its feature landed.
 *
 * Exporting runs in two phases. First every selected format settles — the two
 * with a server preflight (tracked-changes DOCX, proposed contract) fetch
 * `?preflight=1`, and a verdict that isn't clean expands that row in place.
 * Then the formats that came back clean download as one zip.
 *
 * Keeping a non-clean format out of the zip is deliberate. A partial redline is
 * safe to send but is missing findings, and the verdict row is where the
 * associate reads which ones before deciding — §1.6's whole point is that
 * degradation stays visible. They download that file on its own afterwards.
 *
 * Nothing reports "Downloaded." until its response has resolved.
 */

type ExportKey = "memo" | "markup" | "redline" | "clean" | "cleanDocx";
type Outcome = "clean" | "partial" | "fallback";

interface RedlineUnapplied {
  clause_type: string;
  severity: string;
  quoted_text: string | null;
  reason: string;
  explanation: string;
}

interface RedlineWidened {
  clause_type: string;
  severity: string;
  quoted_text: string | null;
  struck: string;
}

interface RedlinePreflight {
  outcome: Outcome;
  appliedCount: number;
  unapplied: RedlineUnapplied[];
  widened: RedlineWidened[];
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
  | { kind: "preparing" }
  | { kind: "downloaded" }
  | { kind: "zipped" }
  | { kind: "error"; message: string }
  | { kind: "downgrade" }
  | { kind: "redline"; verdict: RedlinePreflight }
  | { kind: "clean"; verdict: CleanPreflight };

const IDLE_STATUSES: Record<ExportKey, RowStatus> = {
  memo: { kind: "idle" },
  markup: { kind: "idle" },
  redline: { kind: "idle" },
  clean: { kind: "idle" },
  cleanDocx: { kind: "idle" },
};

export function ExportPicker({
  analysisId,
  includedCount,
  undecidedCount,
  sourceFormat,
  intakeRoute,
  intakeHealthReason,
}: {
  analysisId: string;
  includedCount: number;
  undecidedCount: number;
  sourceFormat: "pdf" | "docx" | "doc";
  intakeRoute: "docx_native" | "pdf" | null;
  intakeHealthReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<ExportKey>>(new Set());
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Record<ExportKey, RowStatus>>(IDLE_STATUSES);

  const short = analysisId.slice(0, 8);
  const singleUrl: Record<ExportKey, string> = {
    memo: `/api/analyses/${analysisId}/export`,
    markup: `/api/analyses/${analysisId}/export-markup`,
    redline: `/api/analyses/${analysisId}/export-redline-docx`,
    clean: `/api/analyses/${analysisId}/export-clean-pdf`,
    cleanDocx: `/api/analyses/${analysisId}/export-clean-docx`,
  };

  // Only a fallback. The route names each file on the way out.
  const fallbackName: Record<ExportKey, string> = {
    memo: `requested-revisions-${short}.pdf`,
    markup: `marked-up-${short}.pdf`,
    redline: `tracked-changes-${short}.docx`,
    clean: `proposed-contract-${short}.pdf`,
    cleanDocx: `proposed-contract-${short}.docx`,
  };
  const zipName = `exports-${short}.zip`;

  // An option the associate cannot take is left out of the list rather than shown
  // greyed with an excuse. The review page already banners a DOCX that had to take
  // the PDF path, and a contract uploaded as a PDF explains itself.
  const redlineAvailable = sourceFormat === "docx" && intakeRoute !== "pdf";
  const cleanAvailable = includedCount > 0;
  const cleanDocxAvailable = redlineAvailable && cleanAvailable;

  const forcedDowngrade = sourceFormat !== "pdf" && intakeRoute !== "docx_native";
  const zippedCount = Object.values(statuses).filter((s) => s.kind === "zipped").length;

  function reset() {
    setSelected(new Set());
    setStarted(false);
    setBusy(false);
    setStatuses(IDLE_STATUSES);
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

  /** Downloads one file on its own — a verdict row's follow-up, or a lone selection. */
  async function downloadOne(key: ExportKey, url: string, filename: string) {
    setBusy(true);
    try {
      await downloadFile(url, filename);
      setStatus(key, { kind: "downloaded" });
    } catch (err) {
      setStatus(key, { kind: "error", message: messageOf(err) });
    } finally {
      setBusy(false);
    }
  }

  /** Runs a format's preflight. Returns true when it came back clean and can be zipped. */
  async function settlePreflight(key: "redline" | "clean"): Promise<boolean> {
    setStatus(key, { kind: "checking" });
    try {
      const res = await fetch(`${singleUrl[key]}?preflight=1`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus(key, {
          kind: "error",
          message:
            body.error ??
            (key === "redline"
              ? "Could not prepare the tracked-changes export."
              : "Could not prepare the proposed contract."),
        });
        return false;
      }
      const verdict = await res.json();
      // A clean redline that struck wording beyond a quote still needs a look.
      if (verdict.outcome === "clean" && !(key === "redline" && verdict.widened?.length)) return true;
      setStatus(key, key === "redline" ? { kind: "redline", verdict } : { kind: "clean", verdict });
      return false;
    } catch {
      setStatus(key, { kind: "error", message: "Could not reach the server." });
      return false;
    }
  }

  async function handleExport() {
    if (selected.size === 0) return;
    setStarted(true);
    setBusy(true);

    const ready: ExportKey[] = [];

    if (selected.has("memo")) ready.push("memo");
    if (selected.has("cleanDocx")) ready.push("cleanDocx");

    if (selected.has("markup")) {
      if (forcedDowngrade) setStatus("markup", { kind: "downgrade" });
      else ready.push("markup");
    }

    // Both preflights are plain fetches, so they can run together.
    const [redlineReady, cleanReady] = await Promise.all([
      selected.has("redline") ? settlePreflight("redline") : Promise.resolve(false),
      selected.has("clean") ? settlePreflight("clean") : Promise.resolve(false),
    ]);
    if (redlineReady) ready.push("redline");
    if (cleanReady) ready.push("clean");

    if (ready.length === 0) {
      setBusy(false);
      return;
    }

    for (const key of ready) setStatus(key, { kind: "preparing" });

    const single = ready.length === 1 ? ready[0] : null;
    const url = single
      ? singleUrl[single]
      : `/api/analyses/${analysisId}/export-zip?formats=${ready.join(",")}`;

    try {
      await downloadFile(url, single ? fallbackName[single] : zipName);
      for (const key of ready) setStatus(key, single ? { kind: "downloaded" } : { kind: "zipped" });
    } catch (err) {
      const message = messageOf(err);
      for (const key of ready) setStatus(key, { kind: "error", message });
    } finally {
      setBusy(false);
    }
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

      <DialogShell
        open={open}
        onClose={close}
        title="Export"
        maxWidth="xl"
        dismissible={!busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
              {started ? "Close" : "Cancel"}
            </Button>
            {!started && (
              <Button size="sm" onClick={handleExport} disabled={selected.size === 0}>
                Export selected ({selected.size})
              </Button>
            )}
          </>
        }
      >
        <Meta className="text-[var(--text-secondary)] mb-3">
          Pick one or more files to export. Several arrive as a single zip.
        </Meta>

        {zippedCount > 0 && (
          <Body as="p" className="mb-3 rounded bg-[var(--surface-muted)] p-2 text-[var(--status-success)]">
            Downloaded {zipName} — {zippedCount} files.
          </Body>
        )}

        {undecidedCount > 0 && (
          <Body as="p" className="mb-3 rounded bg-[var(--surface-muted)] p-2 text-[var(--text-secondary)]">
            {undecidedCount} finding{undecidedCount === 1 ? "" : "s"} still need{undecidedCount === 1 ? "s" : ""} a
            decision and won&apos;t be in any of these exports.
          </Body>
        )}

        <div className="space-y-3">
          {/* Memo */}
          <div className="rounded border border-[var(--border)] p-3">
            <label
              htmlFor="export-memo"
              aria-label="Requested-revisions memo (PDF)"
              className="flex items-start gap-2 cursor-pointer"
            >
              <Checkbox
                id="export-memo"
                className="mt-0.5"
                checked={selected.has("memo")}
                disabled={started}
                onChange={() => toggle("memo")}
              />
              <span>
                <Body as="span" className="block font-medium text-[var(--text-primary)]">
                  Requested-revisions memo (PDF)
                </Body>
                <Meta as="span" className="block text-[var(--text-secondary)]">
                  Findings and {ORG.shortName}&apos;s rationale, for internal review. Not for the property.{" "}
                  {includedCount} finding{includedCount === 1 ? "" : "s"} included.
                </Meta>
              </span>
            </label>
            <RowStatusLine status={statuses.memo} />
          </div>

          {/* Marked-up PDF */}
          <div className="rounded border border-[var(--border)] p-3">
            <label
              htmlFor="export-markup"
              aria-label="Redlined contract (PDF)"
              className="flex items-start gap-2 cursor-pointer"
            >
              <Checkbox
                id="export-markup"
                className="mt-0.5"
                checked={selected.has("markup")}
                disabled={started}
                onChange={() => toggle("markup")}
              />
              <span>
                <Body as="span" className="block font-medium text-[var(--text-primary)]">
                  Redlined contract (PDF)
                </Body>
                <Meta as="span" className="block text-[var(--text-secondary)]">
                  {redlineAvailable
                    ? "Deleted wording struck through in red and new wording underlined in blue, in the text. For a property that can’t work in Word."
                    : "Deleted wording struck through on the original PDF, with the new wording listed on a cover page."}
                </Meta>
              </span>
            </label>
            {statuses.markup.kind === "downgrade" && (
              <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
                <Body as="p" className="font-medium text-[var(--text-primary)]">
                  This document is getting a PDF markup, not tracked changes
                </Body>
                <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
                  {getMarkupReason({ sourceFormat, intakeHealthReason })}
                </Meta>
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setStatus("markup", { kind: "idle" })}
                  >
                    Skip
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => downloadOne("markup", singleUrl.markup, fallbackName.markup)}
                  >
                    Download marked-up PDF
                  </Button>
                </div>
              </div>
            )}
            <RowStatusLine status={statuses.markup} />
          </div>

          {/* Tracked-changes DOCX */}
          {redlineAvailable && (
          <div className="rounded border border-[var(--border)] p-3">
            <label
              htmlFor="export-redline"
              aria-label="Redlined contract (Word, tracked changes)"
              className="flex items-start gap-2 cursor-pointer"
            >
              <Checkbox
                id="export-redline"
                className="mt-0.5"
                checked={selected.has("redline")}
                disabled={started}
                onChange={() => toggle("redline")}
              />
              <span>
                <Body as="span" className="block font-medium text-[var(--text-primary)]">
                  Redlined contract (Word, tracked changes)
                </Body>
                <Meta as="span" className="block text-[var(--text-secondary)]">
                  Redlines as Word tracked changes, for a property that will negotiate in the document.
                </Meta>
              </span>
            </label>
            <RowStatusLine status={statuses.redline} />
            {statuses.redline.kind === "redline" && (
              <RedlineVerdictRow
                verdict={statuses.redline.verdict}
                busy={busy}
                onSkip={() => setStatus("redline", { kind: "idle" })}
                onDownload={() => downloadOne("redline", singleUrl.redline, fallbackName.redline)}
                onDownloadFallback={(url) => downloadOne("redline", url, fallbackName.markup)}
              />
            )}
          </div>
          )}

          {/* Proposed contract */}
          {cleanAvailable && (
          <div className="rounded border border-[var(--border)] p-3">
            <label
              htmlFor="export-clean"
              aria-label="Proposed contract, clean (PDF)"
              className="flex items-start gap-2 cursor-pointer"
            >
              <Checkbox
                id="export-clean"
                className="mt-0.5"
                checked={selected.has("clean")}
                disabled={started}
                onChange={() => toggle("clean")}
              />
              <span>
                <Body as="span" className="block font-medium text-[var(--text-primary)]">
                  Proposed contract, clean (PDF)
                </Body>
                <Meta as="span" className="block text-[var(--text-secondary)]">
                  The contract as it would read if every accepted change applied, for review or to send as a clean
                  attachment.
                </Meta>
              </span>
            </label>
            <RowStatusLine status={statuses.clean} />
            {statuses.clean.kind === "clean" && (
              <CleanVerdictRow
                verdict={statuses.clean.verdict}
                busy={busy}
                onSkip={() => setStatus("clean", { kind: "idle" })}
                onDownload={() => downloadOne("clean", singleUrl.clean, fallbackName.clean)}
                onDownloadFallback={(url) => downloadOne("clean", url, fallbackName.markup)}
              />
            )}
          </div>
          )}

          {/* Proposed contract, Word */}
          {cleanDocxAvailable && (
          <div className="rounded border border-[var(--border)] p-3">
            <label
              htmlFor="export-clean-docx"
              aria-label="Proposed contract, clean (Word)"
              className="flex items-start gap-2 cursor-pointer"
            >
              <Checkbox
                id="export-clean-docx"
                className="mt-0.5"
                checked={selected.has("cleanDocx")}
                disabled={started}
                onChange={() => toggle("cleanDocx")}
              />
              <span>
                <Body as="span" className="block font-medium text-[var(--text-primary)]">
                  Proposed contract, clean (Word)
                </Body>
                <Meta as="span" className="block text-[var(--text-secondary)]">
                  The property&apos;s own Word file with every accepted change applied, in its original formatting.
                </Meta>
              </span>
            </label>
            <RowStatusLine status={statuses.cleanDocx} />
          </div>
          )}
        </div>
      </DialogShell>
    </>
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "The download failed.";
}

function RowStatusLine({ status }: { status: RowStatus }) {
  if (status.kind === "checking") {
    return (
      <Meta as="p" className="mt-2 text-[var(--text-muted)]">
        Checking...
      </Meta>
    );
  }
  if (status.kind === "preparing") {
    return (
      <Meta as="p" className="mt-2 text-[var(--text-muted)]">
        Preparing...
      </Meta>
    );
  }
  if (status.kind === "downloaded") {
    return (
      <Meta as="p" className="mt-2 text-[var(--status-success)]">
        Downloaded.
      </Meta>
    );
  }
  if (status.kind === "zipped") {
    return (
      <Meta as="p" className="mt-2 text-[var(--status-success)]">
        In the zip.
      </Meta>
    );
  }
  if (status.kind === "error") {
    return (
      <Meta as="p" className="mt-2 text-[var(--severity-high)]">
        {status.message}
      </Meta>
    );
  }
  return null;
}

function RedlineVerdictRow({
  verdict,
  busy,
  onSkip,
  onDownload,
  onDownloadFallback,
}: {
  verdict: RedlinePreflight;
  busy: boolean;
  onSkip: () => void;
  onDownload: () => void;
  onDownloadFallback: (url: string) => void;
}) {
  if (verdict.outcome === "fallback") {
    return (
      <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
        <Body as="p" className="font-medium text-[var(--text-primary)]">
          The Word file could not be produced safely
        </Body>
        <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
          Marking up this contract produced a file that failed its checks, so it was discarded rather than sent to
          you. Nothing about the original document has changed.
        </Meta>
        {verdict.fallbackReason && (
          <Meta as="p" className="mt-1 rounded bg-white p-2 text-[var(--text-muted)]">
            {verdict.fallbackReason}
          </Meta>
        )}
        <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
          The marked-up PDF carries the same findings and is safe to send instead.
        </Meta>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>
            Skip
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDownloadFallback(verdict.markupPdfUrl)}>
            Download marked-up PDF
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
      <Body as="p" className="font-medium text-[var(--text-primary)]">
        {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} marked up.
        {verdict.unapplied.length > 0 && ` ${verdict.unapplied.length} could not be.`}
      </Body>

      {verdict.unapplied.length > 0 && (
        <>
          <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
            The file is safe to send. These items are not in the markup, so raise them another way.
          </Meta>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {verdict.unapplied.map((u, i) => (
              <li key={i} className="rounded border border-[var(--border)] bg-white p-2">
                <Meta as="p" className="font-medium text-[var(--text-primary)]">
                  {clauseLabel(u.clause_type)}
                  <span className="ml-2 font-normal text-[var(--text-muted)]">{u.severity}</span>
                </Meta>
                {u.quoted_text && (
                  <Meta as="p" className="mt-1 border-l-2 border-[var(--border)] pl-2 text-[var(--text-muted)]">
                    &ldquo;{u.quoted_text}&rdquo;
                  </Meta>
                )}
                <Meta as="p" className="mt-1 text-[var(--text-muted)]">
                  {u.explanation}
                </Meta>
              </li>
            ))}
          </ul>
        </>
      )}

      {verdict.widened.length > 0 && (
        <>
          <Meta as="p" className="mt-2 text-[var(--text-secondary)]">
            {verdict.widened.length === 1 ? "This change covers" : "These changes cover"} the whole sentence, so{" "}
            {verdict.widened.length === 1 ? "it also strikes" : "they also strike"} wording the finding didn&rsquo;t
            quote. Check {verdict.widened.length === 1 ? "it" : "them"} in Word before sending.
          </Meta>
          <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
            {verdict.widened.map((w, i) => (
              <li key={i} className="rounded border border-[var(--border)] bg-white p-2">
                <Meta as="p" className="font-medium text-[var(--text-primary)]">
                  {clauseLabel(w.clause_type)}
                  <span className="ml-2 font-normal text-[var(--text-muted)]">{w.severity}</span>
                </Meta>
                <Meta as="p" className="mt-1 text-[var(--text-muted)]">
                  Also struck: &ldquo;{w.struck}&rdquo;
                </Meta>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
        <Button size="sm" disabled={busy} onClick={onDownload}>
          {verdict.unapplied.length > 0 ? "Download anyway" : "Download"}
        </Button>
      </div>
    </div>
  );
}

function CleanVerdictRow({
  verdict,
  busy,
  onSkip,
  onDownload,
  onDownloadFallback,
}: {
  verdict: CleanPreflight;
  busy: boolean;
  onSkip: () => void;
  onDownload: () => void;
  onDownloadFallback: (url: string) => void;
}) {
  if (verdict.outcome === "fallback") {
    return (
      <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
        <Body as="p" className="font-medium text-[var(--text-primary)]">
          The proposed contract could not be produced safely
        </Body>
        <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
          Rebuilding this contract produced a document that failed its content check, so it was discarded rather
          than sent to you. A clean copy that quietly omits text reads as finished, which is worse than not having
          one.
        </Meta>
        <ul className="mt-1 space-y-1">
          {verdict.problems.map((p, i) => (
            <li key={i} className="rounded bg-white p-2">
              <Meta className="text-[var(--text-muted)]">{p}</Meta>
            </li>
          ))}
        </ul>
        <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
          The marked-up PDF carries the same changes and is safe to send instead.
        </Meta>
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>
            Skip
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDownloadFallback(verdict.markupPdfUrl)}>
            Download marked-up PDF
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded bg-[var(--surface-muted)] p-2">
      <Body as="p" className="font-medium text-[var(--text-primary)]">
        {verdict.appliedCount} change{verdict.appliedCount === 1 ? "" : "s"} applied. {verdict.unplaced.length} could
        not be placed.
      </Body>
      <Meta as="p" className="mt-1 text-[var(--text-secondary)]">
        The contract below carries its original wording for these items, and lists them with the proposed language
        at the end of the document.
      </Meta>
      <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto">
        {verdict.unplaced.map((u, i) => (
          <li key={i} className="rounded border border-[var(--border)] bg-white p-2">
            <Meta as="p" className="font-medium text-[var(--text-primary)]">
              {clauseLabel(u.clause_type)}
            </Meta>
            <Meta as="p" className="mt-1 text-[var(--text-muted)]">
              {u.reason}
            </Meta>
          </li>
        ))}
      </ul>
      {verdict.additions.length > 0 && (
        <Meta as="p" className="mt-2 text-[var(--text-secondary)]">
          {verdict.additions.length} new clause{verdict.additions.length === 1 ? " is" : "s are"} added at the end,
          under their own heading.
        </Meta>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>
          Skip
        </Button>
        <Button size="sm" disabled={busy} onClick={onDownload}>
          Download
        </Button>
      </div>
    </div>
  );
}
