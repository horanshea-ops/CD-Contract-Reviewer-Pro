"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldInput, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";

export interface Finding {
  id: string;
  clause_type: string;
  is_missing_clause: boolean;
  severity: "high" | "medium" | "low" | "note";
  exposure_amount: number | null;
  exposure_basis: string | null;
  location_section: string | null;
  location_page: number | null;
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

export const SEVERITY_STYLE: Record<
  Finding["severity"],
  { label: string; borderColor: string; borderWidth: string; textColor: string; bg: string }
> = {
  high: {
    label: "HIGH",
    borderColor: "var(--severity-high)",
    borderWidth: "3px",
    textColor: "var(--severity-high)",
    bg: "var(--severity-high-bg)",
  },
  medium: {
    label: "MEDIUM",
    borderColor: "var(--severity-medium)",
    borderWidth: "3px",
    textColor: "var(--severity-medium)",
    bg: "var(--severity-medium-bg)",
  },
  low: {
    label: "LOW",
    borderColor: "var(--severity-low)",
    borderWidth: "2px",
    textColor: "var(--severity-low)",
    bg: "var(--severity-low-bg)",
  },
  note: {
    label: "NOTE",
    borderColor: "var(--severity-note)",
    borderWidth: "2px",
    textColor: "var(--severity-note)",
    bg: "var(--severity-note-bg)",
  },
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
  onSelectFinding,
}: {
  finding: Finding;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
  onSelectFinding?: (finding: Finding) => void;
}) {
  const [mode, setMode] = useState<"view" | "editing" | "dismissing">("view");
  const [editedLanguage, setEditedLanguage] = useState(finding.proposed_language);
  const [dismissalReason, setDismissalReason] = useState(DISMISSAL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changingDecision, setChangingDecision] = useState(false);
  const { showToast } = useToast();

  function cancelToView() {
    setMode("view");
    setChangingDecision(false);
  }

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
        showToast(body.error || "Could not save.", "error");
        return;
      }
      onActionRecorded(finding.id, {
        action,
        edited_language: action === "edit" ? editedLanguage : null,
        dismissal_reason: action === "dismiss" ? reason : null,
      });
      setMode("view");
      setChangingDecision(false);
      showToast(`${ACTION_LABEL[action]}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={{ borderLeftWidth: style.borderWidth, borderLeftColor: style.borderColor }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusPill label={style.label} style={{ background: style.bg, color: style.textColor }} />
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">
            {finding.clause_type.replace(/_/g, " ")}
          </span>
          {finding.is_missing_clause && (
            <span className="text-xs text-[var(--text-muted)]">(missing from contract)</span>
          )}
        </div>
        {finding.current_action && (
          <StatusPill
            label={ACTION_LABEL[finding.current_action.action]}
            className="shrink-0 bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]"
          />
        )}
      </div>

      {!finding.is_missing_clause && finding.quoted_text && (
        <p className="text-xs mb-1">
          {finding.location_page != null ? (
            <button
              onClick={() => onSelectFinding?.(finding)}
              className="text-[var(--cd-navy)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
            >
              Page {finding.location_page} →
            </button>
          ) : (
            <span className="text-[var(--text-muted)]">
              Location not pinpointed — won&apos;t be marked in place if exported
            </span>
          )}
        </p>
      )}

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

      {mode === "view" && finding.current_action && !changingDecision && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setChangingDecision(true)}>
            Change decision
          </Button>
        </div>
      )}

      {mode === "view" && (!finding.current_action || changingDecision) && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" onClick={() => submitAction("accept")} loading={saving} loadingText="Accepting...">
            Accept
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode("editing")} disabled={saving}>
            Edit
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode("dismissing")} disabled={saving}>
            Dismiss
          </Button>
          {finding.current_action && (
            <Button variant="ghost" size="sm" onClick={() => setChangingDecision(false)} disabled={saving}>
              Cancel
            </Button>
          )}
        </div>
      )}

      {mode === "editing" && (
        <div className="mt-3 space-y-2">
          <Field label="Edited language">
            <FieldTextarea value={editedLanguage} onChange={(e) => setEditedLanguage(e.target.value)} rows={4} />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => submitAction("edit")}
              disabled={!editedLanguage.trim()}
              loading={saving}
              loadingText="Saving..."
            >
              Save edit
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelToView}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {mode === "dismissing" && (
        <div className="mt-3 space-y-2">
          <Field label="Reason for dismissal">
            <FieldSelect value={dismissalReason} onChange={(e) => setDismissalReason(e.target.value)}>
              {DISMISSAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </FieldSelect>
          </Field>
          {dismissalReason === "Other" && (
            <Field label="Please specify">
              <FieldInput
                type="text"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Reason"
              />
            </Field>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => submitAction("dismiss")}
              disabled={dismissalReason === "Other" && !customReason.trim()}
              loading={saving}
              loadingText="Dismissing..."
            >
              Confirm dismiss
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelToView}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-[var(--severity-high)] mt-2">
          {error}
        </p>
      )}
    </Card>
  );
}
