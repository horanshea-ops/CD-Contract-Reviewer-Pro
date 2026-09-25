"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldInput, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Body, Meta, Subtitle } from "@/components/ui/typography";
import { formatCalculation } from "@/lib/exposure";
import { clauseLabel, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ORG } from "@/lib/org";
import { SEVERITY_STYLE } from "@/components/severity-style";
import ChangeView from "./change-view";

export interface Finding {
  id: string;
  clause_type: string;
  is_missing_clause: boolean;
  severity: "high" | "medium" | "low" | "note";
  exposure_amount: number | null;
  exposure_basis: string | null;
  /** Null on findings recorded before the app worked exposure figures out itself. */
  exposure_formula?: string | null;
  location_section: string | null;
  /** Null on findings recorded before the model wrote headlines. */
  headline: string | null;
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
  /** Why the change, or part of it, won't go into the redline. Worked out by the analysis API. */
  export_issue?: string | null;
  /** The wording the redline will insert, when it differs from the proposal or edit. */
  redline_language?: string | null;
}

// Shared with the standards library screen.
export { SEVERITY_STYLE };

/** "4. Cancellation and Liquidated Damages" → "§4". Null when there's no leading number. */
function sectionRef(section: string | null): string | null {
  const number = section?.match(/^\s*(\d+(?:\.\d+)*)/)?.[1];
  return number ? `§${number}` : null;
}

/**
 * The exposure figure, a one-line basis, and the calculation behind it on
 * request. A finding from before formulas has only the model's own working,
 * which is long, so it stays closed until asked for.
 */
function ExposureBox({ amount, basis, formula }: { amount: number; basis: string | null; formula: string | null }) {
  const [open, setOpen] = useState(false);
  const detail = formula ? formatCalculation(formula, amount) : basis;
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] px-3 py-2">
      <Subtitle as="p" className="text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">
        {formatCurrency(amount)}
      </Subtitle>
      {formula && basis && (
        <Meta as="p" className="text-[var(--text-secondary)]">
          {basis}
        </Meta>
      )}
      {detail && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-xs text-[var(--cd-navy)] hover:underline mt-0.5"
        >
          {open ? "Hide calculation" : formula ? "Show calculation" : "Show how this was estimated"}
        </button>
      )}
      {detail && open && (
        <Meta as="p" className="text-[var(--text-secondary)] mt-1 [font-variant-numeric:tabular-nums]">
          {detail}
        </Meta>
      )}
    </div>
  );
}

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
  const [whyOpen, setWhyOpen] = useState(false);
  const { showToast } = useToast();

  function cancelToView() {
    setMode("view");
    setChangingDecision(false);
  }

  const style = SEVERITY_STYLE[finding.severity];
  const section = sectionRef(finding.location_section);
  const language =
    finding.current_action?.action === "edit" && finding.current_action.edited_language
      ? finding.current_action.edited_language
      : finding.proposed_language;

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
      <div className="flex items-baseline justify-between gap-3">
        <Meta as="p" className="text-[var(--text-secondary)]">
          <span className="font-semibold" style={{ color: style.textColor }}>
            {style.label}
          </span>
          {" · "}
          {clauseLabel(finding.clause_type)}
          {section && ` · ${section}`}
          {finding.is_missing_clause && " · missing from contract"}
        </Meta>
        {!finding.is_missing_clause && finding.quoted_text && locateMode === "docx" && (
          <LocateLink onClick={() => onSelectFinding?.(finding)}>Show in document →</LocateLink>
        )}
        {!finding.is_missing_clause && finding.quoted_text && locateMode !== "docx" && finding.location_page != null && (
          <LocateLink onClick={() => onSelectFinding?.(finding)}>Page {finding.location_page} →</LocateLink>
        )}
      </div>

      {finding.headline ? (
        <Subtitle as="p" className="text-[var(--text-primary)] mt-2">
          {finding.headline}
        </Subtitle>
      ) : (
        <Body as="p" className="text-[var(--text-primary)] mt-2">
          {finding.finding_text}
        </Body>
      )}

      {finding.exposure_amount != null && (
        <ExposureBox
          amount={finding.exposure_amount}
          basis={finding.exposure_basis}
          formula={finding.exposure_formula ?? null}
        />
      )}

      {!language.trim() && finding.quoted_text ? (
        <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
          <Meta as="p" className="font-semibold uppercase tracking-wide mb-1 text-[var(--text-secondary)]">
            Contract says
          </Meta>
          <Body as="blockquote" className="text-[var(--text-secondary)]">
            &ldquo;{finding.quoted_text}&rdquo;
          </Body>
        </div>
      ) : (
        <ChangeView
          quote={finding.quoted_text}
          language={finding.redline_language ?? language}
          addition={finding.is_missing_clause || !finding.quoted_text}
          footnote={
            locateMode !== "docx" &&
            finding.quoted_text &&
            !finding.is_missing_clause &&
            finding.location_page == null && (
              <Meta as="p" className="text-[var(--text-muted)] mt-1">
                Location not pinpointed, so it won&apos;t be marked in place if exported
              </Meta>
            )
          }
        />
      )}

      <div className="mt-2 flex flex-wrap gap-x-4">
        {finding.headline && (
          <Disclosure open={whyOpen} onToggle={() => setWhyOpen((v) => !v)}>
            Why
          </Disclosure>
        )}
        <Disclosure open={standardOpen} onToggle={() => setStandardOpen((v) => !v)}>
          {ORG.shortName} standard
        </Disclosure>
      </div>
      {whyOpen && finding.headline && (
        <Body as="p" className="mt-1 text-[var(--text-secondary)]">
          {finding.finding_text}
        </Body>
      )}
      {standardOpen && (
        <Body as="p" className="mt-1 text-[var(--text-primary)]">
          {finding.cd_standard}
        </Body>
      )}

      {finding.export_issue && (
        <Meta as="p" className="mt-3 rounded-md bg-[var(--severity-medium-bg)] text-[var(--text-primary)] px-2.5 py-1.5">
          {finding.export_issue}
        </Meta>
      )}

      {mode === "view" && finding.current_action && !changingDecision && (
        <div className="mt-4 flex items-center gap-3">
          <Meta as="span" className="font-medium text-[var(--text-secondary)]">
            {ACTION_LABEL[finding.current_action.action]}
          </Meta>
          <Button variant="secondary" size="sm" onClick={() => setChangingDecision(true)}>
            Change decision
          </Button>
        </div>
      )}

      {mode === "view" && (!finding.current_action || changingDecision) && (
        <div className="flex gap-2 mt-4">
          <Button size="sm" onClick={() => submitAction("accept")} loading={saving} loadingText="Accepting...">
            Accept
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setMode("editing")} disabled={saving}>
            {language.trim() ? "Edit" : "Add wording"}
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

function LocateLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 text-xs text-[var(--cd-navy)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
    >
      {children}
    </button>
  );
}

function Disclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mt-1.5 flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--cd-navy)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className={cn("transition-transform shrink-0", open && "rotate-90")}
      >
        <path d="M6 4l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {children}
    </button>
  );
}
