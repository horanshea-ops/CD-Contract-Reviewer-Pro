"use client";

import { useState } from "react";

export interface Finding {
  id: string;
  clause_type: string;
  is_missing_clause: boolean;
  severity: "high" | "medium" | "low" | "note";
  exposure_amount: number | null;
  exposure_basis: string | null;
  location_section: string | null;
  quoted_text: string | null;
  finding_text: string;
  cd_standard: string;
  proposed_language: string;
  model_confidence: "high" | "medium" | "low";
  current_action: {
    action: "accept" | "edit" | "dismiss";
    edited_language: string | null;
    dismissal_reason: string | null;
  } | null;
}

const SEVERITY_STYLE: Record<Finding["severity"], { label: string; border: string; text: string }> = {
  high: { label: "HIGH", border: "border-l-4 border-l-red-600", text: "text-red-700" },
  medium: { label: "MEDIUM", border: "border-l-4 border-l-amber-500", text: "text-amber-700" },
  low: { label: "LOW", border: "border-l-2 border-l-neutral-400", text: "text-neutral-600" },
  note: { label: "NOTE", border: "border-l-2 border-l-neutral-300", text: "text-neutral-500" },
};

const DISMISSAL_REASONS = [
  "Already negotiated elsewhere in this contract",
  "Client accepted this risk",
  "Not applicable to this property/segment",
  "Standard language is wrong for this case",
  "Other",
];

export default function FindingCard({
  finding,
  onActionRecorded,
}: {
  finding: Finding;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
}) {
  const [mode, setMode] = useState<"view" | "editing" | "dismissing">("view");
  const [editedLanguage, setEditedLanguage] = useState(finding.proposed_language);
  const [dismissalReason, setDismissalReason] = useState(DISMISSAL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const style = SEVERITY_STYLE[finding.severity];

  async function submitAction(action: "accept" | "edit" | "dismiss") {
    setSaving(true);
    setError("");

    const reason = dismissalReason === "Other" ? customReason.trim() : dismissalReason;

    try {
      const res = await fetch(`/api/findings/${finding.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          editedLanguage: action === "edit" ? editedLanguage : undefined,
          dismissalReason: action === "dismiss" ? reason : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not save.");
        return;
      }
      onActionRecorded(finding.id, {
        action,
        edited_language: action === "edit" ? editedLanguage : null,
        dismissal_reason: action === "dismiss" ? reason : null,
      });
      setMode("view");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`bg-white rounded ${style.border} border border-neutral-200 p-4`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className={`text-xs font-bold tracking-wide ${style.text}`}>{style.label}</span>
          <span className="text-xs text-neutral-400 ml-2 uppercase tracking-wide">
            {finding.clause_type.replace(/_/g, " ")}
          </span>
          {finding.is_missing_clause && (
            <span className="text-xs text-neutral-500 ml-2">(missing from contract)</span>
          )}
        </div>
        {finding.current_action && (
          <span className="text-xs font-medium rounded bg-neutral-100 px-2 py-0.5 text-neutral-600 shrink-0">
            {finding.current_action.action === "accept" && "Accepted"}
            {finding.current_action.action === "edit" && "Edited"}
            {finding.current_action.action === "dismiss" && "Dismissed"}
          </span>
        )}
      </div>

      {finding.exposure_amount != null && (
        <p className="text-lg font-semibold text-neutral-900 mb-1">
          ${finding.exposure_amount.toLocaleString()}
          <span className="text-xs font-normal text-neutral-500 ml-2">{finding.exposure_basis}</span>
        </p>
      )}

      <p className="text-sm text-neutral-800 mb-2">{finding.finding_text}</p>

      {finding.quoted_text && (
        <blockquote className="text-sm text-neutral-500 italic border-l-2 border-neutral-200 pl-2 mb-2">
          &ldquo;{finding.quoted_text}&rdquo;
        </blockquote>
      )}

      <details className="text-sm mb-2">
        <summary className="cursor-pointer text-neutral-500">CD standard &amp; proposed language</summary>
        <p className="mt-1 text-neutral-700">
          <span className="font-medium">CD standard: </span>
          {finding.cd_standard}
        </p>
        <p className="mt-1 text-neutral-700">
          <span className="font-medium">Proposed: </span>
          {finding.proposed_language}
        </p>
      </details>

      {mode === "view" && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => submitAction("accept")}
            disabled={saving}
            className="text-xs font-medium rounded bg-neutral-900 text-white px-3 py-1.5 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            onClick={() => setMode("editing")}
            disabled={saving}
            className="text-xs font-medium rounded border border-neutral-300 px-3 py-1.5"
          >
            Edit
          </button>
          <button
            onClick={() => setMode("dismissing")}
            disabled={saving}
            className="text-xs font-medium rounded border border-neutral-300 px-3 py-1.5 text-neutral-500"
          >
            Dismiss
          </button>
        </div>
      )}

      {mode === "editing" && (
        <div className="mt-3 space-y-2">
          <textarea
            value={editedLanguage}
            onChange={(e) => setEditedLanguage(e.target.value)}
            rows={4}
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={() => submitAction("edit")}
              disabled={saving || !editedLanguage.trim()}
              className="text-xs font-medium rounded bg-neutral-900 text-white px-3 py-1.5 disabled:opacity-50"
            >
              Save edit
            </button>
            <button onClick={() => setMode("view")} className="text-xs text-neutral-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "dismissing" && (
        <div className="mt-3 space-y-2">
          <select
            value={dismissalReason}
            onChange={(e) => setDismissalReason(e.target.value)}
            className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          >
            {DISMISSAL_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {dismissalReason === "Other" && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Reason"
              className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => submitAction("dismiss")}
              disabled={saving || (dismissalReason === "Other" && !customReason.trim())}
              className="text-xs font-medium rounded bg-neutral-900 text-white px-3 py-1.5 disabled:opacity-50"
            >
              Confirm dismiss
            </button>
            <button onClick={() => setMode("view")} className="text-xs text-neutral-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
