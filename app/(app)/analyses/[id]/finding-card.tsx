"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldInput, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Meta, ReadingText } from "@/components/ui/typography";
import { formatCurrency, titleCase } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ORG } from "@/lib/org";
import { SEVERITY_STYLE } from "@/components/severity-style";

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

// Shared with the standards library screen.
export { SEVERITY_STYLE };

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
  locateMode = "pdf",
  focused = false,
}: {
  finding: Finding;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
  onSelectFinding?: (finding: Finding) => void;
  /** "docx" for the HTML preview (no page concept — always offers to jump to the match). Defaults to "pdf". */
  locateMode?: "pdf" | "docx";
  /** Keyboard-navigation target, per ROADMAP item 7 — distinct from severity's left border. */
  focused?: boolean;
}) {
  const [mode, setMode] = useState<"view" | "editing" | "dismissing">("view");
  const [editedLanguage, setEditedLanguage] = useState(finding.proposed_language);
  const [dismissalReason, setDismissalReason] = useState(DISMISSAL_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [changingDecision, setChangingDecision] = useState(false);
  const [standardOpen, setStandardOpen] = useState(false);
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
    <Card
      id={`finding-${finding.id}`}
      tabIndex={-1}
      aria-current={focused ? "true" : undefined}
      style={{ borderLeftWidth: style.borderWidth, borderLeftColor: style.borderColor }}
      className={cn(focused && "ring-2 ring-[var(--cd-blue)]")}
    >
      <div className="flex items-baseline justify-between gap-3 pb-2.5 mb-3 border-b border-[var(--border)]">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <Meta as="span" className="font-semibold" style={{ color: style.textColor }}>
            {style.label}
          </Meta>
          <Meta as="span" className="text-[var(--text-secondary)]">
            {titleCase(finding.clause_type)}
          </Meta>
          {finding.is_missing_clause && (
            <Meta as="span" className="text-[var(--text-secondary)]">
              (missing from contract)
            </Meta>
          )}
        </div>
        {finding.current_action && (
          <Meta as="span" className="shrink-0 text-[var(--text-secondary)]">
            {ACTION_LABEL[finding.current_action.action]}
          </Meta>
        )}
      </div>

      {!finding.is_missing_clause && finding.quoted_text && (
        <Meta as="p" className="mb-1">
          {locateMode === "docx" ? (
            <button
              onClick={() => onSelectFinding?.(finding)}
              className="text-[var(--cd-navy)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
            >
              Show in document →
            </button>
          ) : finding.location_page != null ? (
            <button
              onClick={() => onSelectFinding?.(finding)}
              className="text-[var(--cd-navy)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
            >
              Page {finding.location_page} →
            </button>
          ) : (
            <span className="text-[var(--text-secondary)]">
              Location not pinpointed, so it won&apos;t be marked in place if exported
            </span>
          )}
        </Meta>
      )}

      {finding.exposure_amount != null && (
        <ReadingText as="p" className="text-[var(--text-primary)] mb-2">
          <span className="font-semibold [font-variant-numeric:tabular-nums]">
            {formatCurrency(finding.exposure_amount)}
          </span>
          {finding.exposure_basis && (
            <span className="text-[var(--text-secondary)]"> — {finding.exposure_basis}</span>
          )}
        </ReadingText>
      )}

      <ReadingText className="text-[var(--text-primary)] mb-2">{finding.finding_text}</ReadingText>

      {finding.quoted_text && (
        <ReadingText
          as="blockquote"
          className="text-[var(--text-secondary)] border-l-2 border-[var(--border-strong)] pl-2 mb-2"
        >
          &ldquo;{finding.quoted_text}&rdquo;
        </ReadingText>
      )}

      <div className="pt-2.5 mt-1 mb-2 border-t border-[var(--border)]">
        <Meta as="p" className="font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-1">
          Proposed language
        </Meta>
        <ReadingText className="text-[var(--text-primary)]">{finding.proposed_language}</ReadingText>
      </div>

      <div className="mb-2">
        <button
          type="button"
          onClick={() => setStandardOpen((v) => !v)}
          aria-expanded={standardOpen}
          className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--cd-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className={cn("transition-transform shrink-0", standardOpen && "rotate-90")}
          >
            <path d="M6 4l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {ORG.shortName} standard
        </button>
        {standardOpen && (
          <Meta as="p" className="mt-1 text-[var(--text-primary)]">
            {finding.cd_standard}
          </Meta>
        )}
      </div>

      {mode === "view" && finding.current_action && !changingDecision && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setChangingDecision(true)}>
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
          <Button variant="ghost" size="sm" onClick={() => setMode("dismissing")} disabled={saving}>
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
            <FieldTextarea value={editedLanguage} onChange={(e) => setEditedLanguage(e.target.value)} rows={10} />
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
        <Meta as="p" role="alert" className="text-[var(--severity-high)] mt-2">
          {error}
        </Meta>
      )}
    </Card>
  );
}
