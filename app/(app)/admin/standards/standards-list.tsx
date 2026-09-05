"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";

export interface StandardRow {
  id: string;
  clause_type: string;
  segment: string;
  position: string;
  fallback_language: string;
  walk_away_condition: string;
  severity_default: "high" | "medium" | "low" | "note";
  version: string;
  provenance: "industry_default" | "extracted" | "cd_validated";
  validated_by: string | null;
  validated_at: string | null;
  updated_by: string | null;
  updated_at: string;
}

const PROVENANCE_STYLE: Record<StandardRow["provenance"], { label: string; className: string }> = {
  industry_default: { label: "Industry default · unvalidated", className: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium)]" },
  extracted: { label: "Extracted from CD contracts · unvalidated", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  cd_validated: { label: "CD validated", className: "bg-[var(--status-success-bg)] text-[var(--status-success)]" },
};

const SEVERITY_OPTIONS = ["high", "medium", "low", "note"] as const;
const PROVENANCE_OPTIONS = ["industry_default", "extracted", "cd_validated"] as const;

export default function StandardsList({
  initialStandards,
  associateNames,
}: {
  initialStandards: StandardRow[];
  associateNames: Record<string, string>;
}) {
  const [standards, setStandards] = useState(initialStandards);

  function handleUpdated(updated: StandardRow) {
    setStandards((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  return (
    <div className="space-y-3">
      {standards.map((s) => (
        <StandardCard key={s.id} standard={s} associateNames={associateNames} onUpdated={handleUpdated} />
      ))}
    </div>
  );
}

function StandardCard({
  standard,
  associateNames,
  onUpdated,
}: {
  standard: StandardRow;
  associateNames: Record<string, string>;
  onUpdated: (updated: StandardRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();
  const [form, setForm] = useState({
    position: standard.position,
    fallback_language: standard.fallback_language,
    walk_away_condition: standard.walk_away_condition,
    severity_default: standard.severity_default,
    provenance: standard.provenance,
  });

  const provenanceStyle = PROVENANCE_STYLE[standard.provenance];

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/standards/${standard.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not save.");
        showToast(body.error || "Could not save.", "error");
        return;
      }
      onUpdated(body);
      setEditing(false);
      showToast("Standard saved.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setForm({
      position: standard.position,
      fallback_language: standard.fallback_language,
      walk_away_condition: standard.walk_away_condition,
      severity_default: standard.severity_default,
      provenance: standard.provenance,
    });
    setEditing(false);
    setError("");
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide">
            {standard.clause_type.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-[var(--text-muted)] ml-2">segment: {standard.segment}</span>
        </div>
        <StatusPill label={provenanceStyle.label} className={`shrink-0 ${provenanceStyle.className}`} />
      </div>

      {standard.provenance === "cd_validated" && standard.validated_by && (
        <p className="text-xs text-[var(--text-muted)] mb-2">
          Validated by {associateNames[standard.validated_by] ?? "unknown"}
          {standard.validated_at && ` on ${new Date(standard.validated_at).toLocaleDateString()}`}
        </p>
      )}

      {!editing ? (
        <>
          <div className="text-sm text-[var(--text-primary)] mb-2">
            <span className="font-medium">Severity default: </span>
            {standard.severity_default}
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-2">{standard.position}</p>
          <details className="text-sm mb-2">
            <summary className="cursor-pointer text-[var(--text-secondary)]">Fallback language &amp; walk-away condition</summary>
            <p className="mt-1 text-[var(--text-primary)]">
              <span className="font-medium">Fallback: </span>
              {standard.fallback_language}
            </p>
            <p className="mt-1 text-[var(--text-primary)]">
              <span className="font-medium">Walk-away: </span>
              {standard.walk_away_condition || <span className="text-[var(--text-muted)]">none set</span>}
            </p>
          </details>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <Field label="Position">
            <FieldTextarea
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              rows={3}
            />
          </Field>
          <Field label="Fallback language">
            <FieldTextarea
              value={form.fallback_language}
              onChange={(e) => setForm((f) => ({ ...f, fallback_language: e.target.value }))}
              rows={4}
            />
          </Field>
          <Field label="Walk-away condition">
            <FieldTextarea
              value={form.walk_away_condition}
              onChange={(e) => setForm((f) => ({ ...f, walk_away_condition: e.target.value }))}
              rows={2}
              placeholder="Leave blank if none"
            />
          </Field>
          <div className="flex gap-4">
            <Field label="Severity default">
              <FieldSelect
                value={form.severity_default}
                onChange={(e) => setForm((f) => ({ ...f, severity_default: e.target.value as StandardRow["severity_default"] }))}
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label="Provenance">
              <FieldSelect
                value={form.provenance}
                onChange={(e) => setForm((f) => ({ ...f, provenance: e.target.value as StandardRow["provenance"] }))}
              >
                {PROVENANCE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </FieldSelect>
            </Field>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={saving} loadingText="Saving...">
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-[var(--severity-high)]">
              {error}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
