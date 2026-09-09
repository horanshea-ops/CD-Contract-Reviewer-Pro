"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { startDownload } from "@/lib/download";
import { getMarkupReason } from "@/lib/pdf-markup-reason";

/**
 * Exports the marked-up PDF. For a document forced onto this path — a
 * legacy .doc, or a .docx that failed the intake read — the associate sees
 * why before the download starts, matching §1.7.6. The explanation is
 * app-only; the PDF itself never says why it's a PDF (see
 * lib/pdf-markup-reason.ts).
 *
 * For a genuine PDF upload or a healthy .docx, the download starts
 * immediately, same as before this dialog existed.
 */
export function MarkupExportButton({
  analysisId,
  sourceFormat,
  intakeRoute,
  intakeHealthReason,
}: {
  analysisId: string;
  sourceFormat: "pdf" | "docx" | "doc";
  intakeRoute: "docx_native" | "pdf" | null;
  intakeHealthReason: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const downloadUrl = `/api/analyses/${analysisId}/export-markup`;
  const forcedDowngrade = sourceFormat !== "pdf" && intakeRoute !== "docx_native";

  function handleClick() {
    if (forcedDowngrade) {
      setConfirming(true);
      return;
    }
    startDownload(downloadUrl);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={handleClick} className="shrink-0">
        Export marked-up PDF
      </Button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              This document is getting a PDF markup, not tracked changes
            </h2>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {getMarkupReason({ sourceFormat, intakeHealthReason })}
            </p>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              The PDF carries every proposed change; this note is only shown here, not in the file.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  startDownload(downloadUrl);
                  setConfirming(false);
                }}
              >
                Download marked-up PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
