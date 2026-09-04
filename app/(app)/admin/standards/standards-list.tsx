"use client";

import { useState } from "react";

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
  cd_validated: { label: "CD validated", className: "bg-emerald-50 text-emerald-700" },
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
        return;
      }
      onUpdated(body);
      setEditing(false);
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
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <span className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wide">
            {standard.clause_type.replace(/_/g, " ")}
          </span>
          <span className="text-xs text-[var(--text-muted)] ml-2">segment: {standard.segment}</span>
        </div>
        <span className={`text-xs font-medium rounded px-2 py-0.5 shrink-0 ${provenanceStyle.className}`}>
          {provenanceStyle.label}
        </span>
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
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
          >
            Edit
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Position</label>
            <textarea
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              rows={3}
              className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Fallback language</label>
            <textarea
              value={form.fallback_language}
              onChange={(e) => setForm((f) => ({ ...f, fallback_language: e.target.value }))}
              rows={4}
              className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Walk-away condition</label>
            <textarea
              value={form.walk_away_condition}
              onChange={(e) => setForm((f) => ({ ...f, walk_away_condition: e.target.value }))}
              rows={2}
              placeholder="Leave blank if none"
              className="w-full rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Severity default</label>
              <select
                value={form.severity_default}
                onChange={(e) => setForm((f) => ({ ...f, severity_default: e.target.value as StandardRow["severity_default"] }))}
                className="rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
              >
                {SEVERITY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Provenance</label>
              <select
                value={form.provenance}
                onChange={(e) => setForm((f) => ({ ...f, provenance: e.target.value as StandardRow["provenance"] }))}
                className="rounded-md border border-[var(--border-strong)] px-2 py-1.5 text-sm"
              >
                {PROVENANCE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="text-xs font-medium rounded-md bg-[var(--cd-navy)] text-white px-3 py-1.5 hover:bg-[var(--cd-navy-dark)] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={cancel} className="text-xs text-[var(--text-secondary)]">
              Cancel
            </button>
          </div>
          {error && <p className="text-xs text-[var(--severity-high)]">{error}</p>}
        </div>
      )}
    </div>
  );
}
