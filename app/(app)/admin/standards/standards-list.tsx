"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { Body, Meta } from "@/components/ui/typography";
import { SEVERITY_STYLE } from "@/components/severity-style";
import { SeverityToggles } from "@/components/severity-toggles";
import { clauseLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ORG } from "@/lib/org";

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

// Short labels, because the banner above the list already says which are unvalidated.
const PROVENANCE_STYLE: Record<StandardRow["provenance"], { label: string; className: string }> = {
  industry_default: { label: "Industry default", className: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium)]" },
  extracted: { label: "Extracted", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  cd_validated: { label: `${ORG.shortName} validated`, className: "bg-[var(--status-success-bg)] text-[var(--status-success)]" },
};

const SEVERITY_OPTIONS = ["high", "medium", "low", "note"] as const;
type Severity = StandardRow["severity_default"];

/** Section labels share the finding card's style: small, semibold, uppercase. */
const LABEL_CLASSES = "font-semibold uppercase tracking-wide";
const PROVENANCE_OPTIONS = ["industry_default", "extracted", "cd_validated"] as const;

export default function StandardsList({
  initialStandards,
  associateNames,
}: {
  initialStandards: StandardRow[];
  associateNames: Record<string, string>;
}) {
  const [standards, setStandards] = useState(initialStandards);
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());
  const [query, setQuery] = useState("");

  function handleUpdated(updated: StandardRow) {
    setStandards((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function toggleSeverity(severity: Severity) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) next.delete(severity);
      else next.add(severity);
      return next;
    });
  }

  const counts = useMemo(() => {
    const tally: Record<Severity, number> = { high: 0, medium: 0, low: 0, note: 0 };
    for (const s of standards) tally[s.severity_default]++;
    return tally;
  }, [standards]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = standards.filter(
      (s) =>
        !hidden.has(s.severity_default) &&
        (!q || clauseLabel(s.clause_type).toLowerCase().includes(q) || s.position.toLowerCase().includes(q))
    );
    return SEVERITY_OPTIONS.map((severity) => ({
      severity,
      rows: shown.filter((s) => s.severity_default === severity),
    })).filter((group) => group.rows.length > 0);
  }, [standards, hidden, query]);

  const filtersActive = hidden.size > 0 || query.trim() !== "";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SeverityToggles counts={counts} hidden={hidden} onToggle={toggleSeverity} />
        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setHidden(new Set());
              setQuery("");
            }}
            className="text-xs text-[var(--cd-navy)] hover:underline"
          >
            Clear filters
          </button>
        )}
        <div className="relative w-full sm:w-64 sm:ml-auto">
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          >
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 16l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clause or position..."
            aria-label="Search standards"
            className="w-full rounded-md border border-[var(--border-strong)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <Body as="p" className="text-[var(--text-secondary)] py-8 text-center">
          No standards match these filters.
        </Body>
      ) : (
        <div className="space-y-6">
          {groups.map(({ severity, rows }) => (
            <section key={severity}>
              <Meta as="h2" className={cn(LABEL_CLASSES, "mb-2")} style={{ color: SEVERITY_STYLE[severity].textColor }}>
                {SEVERITY_STYLE[severity].label} · {rows.length}
              </Meta>
              <Card padding="none" className="overflow-hidden divide-y divide-[var(--border)]">
                {rows.map((s) => (
                  <StandardItem key={s.id} standard={s} associateNames={associateNames} onUpdated={handleUpdated} />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function StandardItem({
  standard,
  associateNames,
  onUpdated,
}: {
  standard: StandardRow;
  associateNames: Record<string, string>;
  onUpdated: (updated: StandardRow) => void;
}) {
  const [open, setOpen] = useState(false);
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

  const meta = [
    standard.segment !== "default" && `Segment: ${standard.segment}`,
    standard.provenance === "cd_validated" &&
      standard.validated_by &&
      `Validated by ${associateNames[standard.validated_by] ?? "unknown"}${
        standard.validated_at ? ` on ${new Date(standard.validated_at).toLocaleDateString()}` : ""
      }`,
    `Updated ${new Date(standard.updated_at).toLocaleDateString()}${
      standard.updated_by ? ` by ${associateNames[standard.updated_by] ?? "unknown"}` : ""
    }`,
  ].filter(Boolean);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          className={cn("mt-1.5 shrink-0 text-[var(--text-muted)] transition-transform", open && "rotate-90")}
        >
          <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
        <div className="min-w-0 flex-1">
          <Body as="span" className="block font-medium text-[var(--text-primary)]">
            {clauseLabel(standard.clause_type)}
          </Body>
          {!open && (
            <Body as="span" className="block truncate text-[var(--text-secondary)]">
              {standard.position}
            </Body>
          )}
        </div>
        <StatusPill label={provenanceStyle.label} className={`shrink-0 ${provenanceStyle.className}`} />
      </button>

      {open && (
        <div className="px-5 pb-4 pl-10">
          {!editing ? (
            <div className="space-y-3">
              <Section label="Position">{standard.position}</Section>
              <Section label="Fallback language">{standard.fallback_language}</Section>
              <Section label="Walk-away">
                {standard.walk_away_condition || <span className="text-[var(--text-muted)]">None set</span>}
              </Section>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Meta as="span" className="text-[var(--text-muted)]">
                  {meta.join(" · ")}
                </Meta>
              </div>
            </div>
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
                <Meta as="p" role="alert" className="text-[var(--severity-high)]">
                  {error}
                </Meta>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Meta as="p" className={cn(LABEL_CLASSES, "text-[var(--text-secondary)] mb-1")}>
        {label}
      </Meta>
      <Body as="div" className="text-[var(--text-primary)]">
        {children}
      </Body>
    </div>
  );
}
