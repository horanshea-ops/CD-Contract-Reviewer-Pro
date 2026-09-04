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

const SEVERITY_STYLE: Record<
  Finding["severity"],
  { label: string; borderColor: string; borderWidth: string; textColor: string }
> = {
  high: { label: "HIGH", borderColor: "var(--severity-high)", borderWidth: "4px", textColor: "var(--severity-high)" },
  medium: {
    label: "MEDIUM",
    borderColor: "var(--severity-medium)",
    borderWidth: "4px",
    textColor: "var(--severity-medium)",
  },
  low: { label: "LOW", borderColor: "var(--severity-low)", borderWidth: "2px", textColor: "var(--severity-low)" },
  note: { label: "NOTE", borderColor: "var(--severity-note)", borderWidth: "2px", textColor: "var(--severity-note)" },
};

const DISMISSAL_REASONS = [
  "Already negotiated elsewhere in this contract",
  "Client accepted this risk",
  "Not applicable to this property/segment",
  "Standard language is wrong for this case",
  "Other",
];

const ACTION_LABEL: Record<string, string> = {
  accept: "Accepted",
  edit: "Edited",
  dismiss: "Dismissed",
};

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
    <div
      className="bg-white rounded-md border border-[var(--border)] p-4"
      style={{ borderLeftWidth: style.borderWidth, borderLeftColor: style.borderColor }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-xs font-bold tracking-wide" style={{ color: style.textColor }}>
            {style.label}
          </span>
          <span className="text-xs text-[var(--text-muted)] ml-2 uppercase tracking-wide">
            {finding.clause_type.replace(/_/g, " ")}
          </span>
          {finding.is_missing_clause && (
            <span className="text-xs text-[var(--text-muted)] ml-2">(missing from contract)</span>
          )}
        </div>
        {finding.current_action && (
          <span className="text-xs font-medium rounded bg-[var(--cd-blue-pale)] px-2 py-0.5 text-[var(--cd-navy)] shrink-0">
            {ACTION_LABEL[finding.current_action.action]}
          </span>
        )}
      </div>

      {finding.exposure_amount != null && (
        <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">
          ${finding.exposure_amount.toLocaleString()}
          <span className="text-xs font-normal text-[var(--text-secondary)] ml-2">{finding.exposure_basis}</span>
        </p>
      )}

      <p className="text-sm text-[var(--text-primary)] mb-2">{finding.finding_text}</p>

      {finding.quoted_text && (
        <blockquote className="text-sm text-[var(--text-secondary)] italic border-l-2 border-[var(--border)] pl-2 mb-2">
          &ldquo;{finding.quoted_text}&rdquo;
        </blockquote>
      )}

      <details className="text-sm mb-2">
        <summary className="cursor-pointer text-[var(--text-secondary)]">CD standard &amp; proposed language</summary>
        <p className="mt-1 text-[var(--text-primary)]">
          <span className="font-medium">CD standard: </span>
          {finding.cd_standard}
        </p>
        <p className="mt-1 text-[var(--text-primary)]">
          <span className="font-medium">Proposed: </span>
          {finding.proposed_language}
        </p>
      </details>

      {mode === "view" && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => submitAction("accept")}
            disabled={saving}
            className="text-xs font-medium rounded-md bg-[var(--cd-navy)] text-white px-3 py-1.5 hover:bg-[var(--cd-navy-dark)] transition-colors disabled:opacity-50"
          >
            Accept
          </button>
          <button
            onClick={() => setMode("editing")}
            disabled={saving}
            className="text-xs font-medium rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
          >
            Edit
          </button>
          <button
            onClick={() => setMode("dismissing")}
            disabled={saving}
            className="text-xs font-medium rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]"
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
            className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => submitAction("edit")}
              disabled={saving || !editedLanguage.trim()}
              className="text-xs font-medium rounded-md bg-[var(--cd-navy)] text-white px-3 py-1.5 hover:bg-[var(--cd-navy-dark)] transition-colors disabled:opacity-50"
            >
              Save edit
            </button>
            <button onClick={() => setMode("view")} className="text-xs text-[var(--text-secondary)]">
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
            className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
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
              className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => submitAction("dismiss")}
              disabled={saving || (dismissalReason === "Other" && !customReason.trim())}
              className="text-xs font-medium rounded-md bg-[var(--cd-navy)] text-white px-3 py-1.5 hover:bg-[var(--cd-navy-dark)] transition-colors disabled:opacity-50"
            >
              Confirm dismiss
            </button>
            <button onClick={() => setMode("view")} className="text-xs text-[var(--text-secondary)]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-[var(--severity-high)] mt-2">{error}</p>}
    </div>
  );
}
