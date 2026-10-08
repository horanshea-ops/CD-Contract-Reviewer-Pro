"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Field, FieldInput, FieldSelect, FieldTextarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Body, Meta } from "@/components/ui/typography";
import { SEVERITY_STYLE } from "@/components/severity-style";
import { CATEGORY_KEYS, CATEGORY_STYLE } from "@/components/category-style";
import { SeverityToggles } from "@/components/severity-toggles";
import { DEFAULT_POSITIONS, POSITION_SOURCES, readPosition } from "@/lib/exposures/cd-positions";
import { clauseLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ORG } from "@/lib/org";
import type { StandardSet } from "@/lib/standards/sets";
import type { Category, LibrarySeverity } from "@/lib/standards/types";
import { BrandsCovered } from "./brands-covered";
import { StandardsSetBar } from "./standards-set-bar";

export interface StandardRow {
  id: string;
  clause_type: string;
  segment: string;
  category: Category;
  position: string;
  fallback_language: string;
  walk_away_condition: string;
  severity_default: LibrarySeverity;
  compromise_range: string;
  version: string;
  provenance: "industry_default" | "extracted" | "cd_validated";
  validated_by: string | null;
  validated_at: string | null;
  updated_by: string | null;
  updated_at: string;
  retired_at: string | null;
}

/** Where a standard came from. Shown when a row is opened, and set in the Edit form. */
const PROVENANCE_LABEL: Record<StandardRow["provenance"], string> = {
  industry_default: "Industry default",
  extracted: "Extracted",
  cd_validated: `${ORG.shortName} validated`,
};

const SEVERITY_OPTIONS = ["high", "medium", "low"] as const;
type Severity = StandardRow["severity_default"];

/** Plain names for the severity menus. */
const SEVERITY_NAME: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

/** What the tool does with each category's findings, shown under its heading. */
const CATEGORY_HINT: Record<Category, string> = {
  business: "Proposes CD's wording in the redline.",
  legal: "Explains the risk to the associate. Never proposes wording.",
  other: "Notes the point without wording.",
};

/** Section labels share the finding card's style: small, semibold, uppercase. */
const LABEL_CLASSES = "font-semibold uppercase tracking-wide";

const COMPROMISE_HINT = "Where CD could settle if the property pushes back. Only the associate sees it, on the review card.";
const PROVENANCE_OPTIONS = ["industry_default", "extracted", "cd_validated"] as const;

export default function StandardsList({
  initialStandards,
  associateNames,
  sets = [],
  initialSet = null,
}: {
  initialStandards: StandardRow[];
  associateNames: Record<string, string>;
  /** Every standards set, for the picker. Empty before sets exist in the database. */
  sets?: StandardSet[];
  /** The set these standards belong to. */
  initialSet?: StandardSet | null;
}) {
  const [standards, setStandards] = useState(initialStandards);
  const [set, setSet] = useState(initialSet);
  const [hidden, setHidden] = useState<Set<Severity>>(new Set());
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<Category | null>(null);
  const [adding, setAdding] = useState(false);
  const { showToast } = useToast();

  const active = useMemo(() => standards.filter((s) => !s.retired_at), [standards]);
  const retired = useMemo(() => standards.filter((s) => s.retired_at), [standards]);

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

  /** Shows the move at once, and puts it back if the save fails. */
  async function moveTo(id: string, category: Category) {
    const before = standards.find((s) => s.id === id);
    if (!before || before.category === category) return;
    handleUpdated({ ...before, category });
    const res = await fetch(`/api/admin/standards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      handleUpdated(before);
      showToast(body?.error || "Could not move the standard. Try again.", "error");
      return;
    }
    handleUpdated(body);
    showToast(`${clauseLabel(before.clause_type)} moved to ${CATEGORY_STYLE[category].name}.`);
  }

  async function restore(row: StandardRow) {
    const res = await fetch(`/api/admin/standards/${row.id}/restore`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res?.ok) {
      showToast(body?.error || "Could not restore the standard. Try again.", "error");
      return;
    }
    handleUpdated(body);
    showToast(`${clauseLabel(row.clause_type)} restored.`);
  }

  const counts = useMemo(() => {
    const tally: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const s of active) tally[s.severity_default]++;
    return tally;
  }, [active]);

  const filtersActive = hidden.size > 0 || query.trim() !== "";

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = active.filter(
      (s) =>
        !hidden.has(s.severity_default) &&
        (!q || clauseLabel(s.clause_type).toLowerCase().includes(q) || s.position.toLowerCase().includes(q))
    );
    // Unfiltered, every group shows, empty ones too, so there is somewhere to drop.
    return CATEGORY_KEYS.map((category) => ({
      category,
      rows: shown
        .filter((s) => s.category === category)
        .sort((a, b) => SEVERITY_OPTIONS.indexOf(a.severity_default) - SEVERITY_OPTIONS.indexOf(b.severity_default)),
    })).filter((group) => (filtersActive ? group.rows.length > 0 : true));
  }, [active, hidden, query, filtersActive]);

  return (
    <div>
      {set && (
        <StandardsSetBar<StandardRow>
          sets={sets}
          set={set}
          count={active.length}
          hasRemoved={retired.length > 0}
          onSwitched={setSet}
          onCopied={setStandards}
        />
      )}

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <SeverityToggles keys={[...SEVERITY_OPTIONS]} counts={counts} hidden={hidden} onToggle={toggleSeverity} />
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
        <Button size="sm" onClick={() => setAdding(true)}>
          Add standard
        </Button>
      </div>

      {groups.length === 0 ? (
        <Body as="p" className="text-[var(--text-secondary)] py-8 text-center">
          {active.length === 0 ? "No standards in this set yet." : "No standards match these filters."}
        </Body>
      ) : (
        <div className="space-y-6">
          {groups.map(({ category, rows }) => {
            const draggedFrom = dragging ? active.find((s) => s.id === dragging)?.category : null;
            const canDrop = !!dragging && draggedFrom !== category;
            return (
              <section
                key={category}
                aria-label={`${CATEGORY_STYLE[category].name} standards`}
                onDragOver={(e) => {
                  if (!canDrop) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== category) setDropTarget(category);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || dragging;
                  setDropTarget(null);
                  setDragging(null);
                  if (id) void moveTo(id, category);
                }}
              >
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                  <Meta as="h2" className={LABEL_CLASSES} style={{ color: CATEGORY_STYLE[category].textColor }}>
                    {CATEGORY_STYLE[category].label} · {rows.length}
                  </Meta>
                  <Meta as="p" className="text-[var(--text-muted)]">
                    {CATEGORY_HINT[category]}
                  </Meta>
                </div>
                <Card
                  padding="none"
                  className={cn(
                    "overflow-hidden divide-y divide-[var(--border)] transition-shadow",
                    canDrop && "ring-1 ring-[var(--border-strong)]",
                    dropTarget === category && canDrop && "ring-2 ring-[var(--cd-blue)] bg-[var(--cd-blue-pale)]"
                  )}
                >
                  {rows.length === 0 ? (
                    <Body as="p" className="px-5 py-4 text-[var(--text-muted)]">
                      No standards here. Drag one in to make it {CATEGORY_STYLE[category].name.toLowerCase()}.
                    </Body>
                  ) : (
                    rows.map((s) => (
                      <StandardItem
                        key={s.id}
                        standard={s}
                        associateNames={associateNames}
                        onUpdated={handleUpdated}
                        dragging={dragging === s.id}
                        onDragStart={() => setDragging(s.id)}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                      />
                    ))
                  )}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {retired.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-[var(--text-secondary)]">
            Removed standards · {retired.length}
          </summary>
          <Card padding="none" className="mt-2 overflow-hidden divide-y divide-[var(--border)]">
            {retired.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Body as="span" className="block font-medium text-[var(--text-primary)]">
                    {clauseLabel(s.clause_type)}
                  </Body>
                  <Meta as="span" className="block text-[var(--text-muted)]">
                    Removed {new Date(s.retired_at!).toLocaleDateString()}. It isn&apos;t used in reviews.
                  </Meta>
                </div>
                <Button variant="secondary" size="sm" onClick={() => restore(s)}>
                  Restore
                </Button>
              </div>
            ))}
          </Card>
        </details>
      )}

      <Meta as="p" className="mt-8 text-[var(--text-muted)] hidden sm:block">
        Drag a standard into another group to change its category.
      </Meta>

      {set && <BrandsCovered set={set} onChanged={setSet} />}

      <AddStandardDialog
        open={adding}
        setKey={set?.key}
        onClose={() => setAdding(false)}
        onAdded={(row) => {
          setStandards((prev) => [...prev, row]);
          setAdding(false);
          showToast(`${clauseLabel(row.clause_type)} added.`);
        }}
      />
    </div>
  );
}

function AddStandardDialog({
  open,
  setKey,
  onClose,
  onAdded,
}: {
  open: boolean;
  /** The set the standard is added to. */
  setKey?: string;
  onClose: () => void;
  onAdded: (row: StandardRow) => void;
}) {
  const empty = {
    name: "",
    category: "business" as Category,
    position: "",
    fallback_language: "",
    walk_away_condition: "",
    compromise_range: "",
    severity_default: "medium" as Severity,
  };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setForm(empty);
    setError("");
    onClose();
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/standards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, set_key: setKey }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        setError(body?.error || "Could not add the standard. Try again.");
        return;
      }
      setForm(empty);
      onAdded(body);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onClose={close}
      title="Add a standard"
      maxWidth="xl"
      scrollBody
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={saving} loadingText="Adding...">
            Add standard
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Body as="p" className="text-[var(--text-secondary)]">
          It&apos;s used from the next review on, marked as validated by you.
        </Body>
        <Field label="Clause name" hint="For example, Late checkout. Reviews show it under this name.">
          <FieldInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <div className="flex gap-4">
          <Field label="Category" hint={CATEGORY_HINT[form.category]}>
            <FieldSelect
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
            >
              {CATEGORY_KEYS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_STYLE[c].name}
                </option>
              ))}
            </FieldSelect>
          </Field>
          <Field label="Severity">
            <FieldSelect
              value={form.severity_default}
              onChange={(e) => setForm((f) => ({ ...f, severity_default: e.target.value as Severity }))}
            >
              {SEVERITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_NAME[s]}
                </option>
              ))}
            </FieldSelect>
          </Field>
        </div>
        <Field label="Position">
          <FieldTextarea
            value={form.position}
            onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
            rows={3}
          />
        </Field>
        {form.category === "business" && (
          <>
            <Field label="Fallback language" hint="The contract wording to propose when a contract falls short.">
              <FieldTextarea
                value={form.fallback_language}
                onChange={(e) => setForm((f) => ({ ...f, fallback_language: e.target.value }))}
                rows={4}
              />
            </Field>
            <Field label="Compromise range" hint={COMPROMISE_HINT}>
              <FieldTextarea
                value={form.compromise_range}
                onChange={(e) => setForm((f) => ({ ...f, compromise_range: e.target.value }))}
                rows={2}
                placeholder="Leave blank if none"
              />
            </Field>
          </>
        )}
        <Field label="Walk-away condition">
          <FieldTextarea
            value={form.walk_away_condition}
            onChange={(e) => setForm((f) => ({ ...f, walk_away_condition: e.target.value }))}
            rows={2}
            placeholder="Leave blank if none"
          />
        </Field>
        {error && (
          <Meta as="p" role="alert" className="text-[var(--severity-high)]">
            {error}
          </Meta>
        )}
      </div>
    </DialogShell>
  );
}

function StandardItem({
  standard,
  associateNames,
  onUpdated,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  standard: StandardRow;
  associateNames: Record<string, string>;
  onUpdated: (updated: StandardRow) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();
  const [form, setForm] = useState(formOf(standard));

  const severityStyle = SEVERITY_STYLE[standard.severity_default];
  const isBusiness = standard.category === "business";

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

  async function remove() {
    setRemoving(true);
    try {
      const res = await fetch(`/api/admin/standards/${standard.id}`, { method: "DELETE" }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        showToast(body?.error || "Could not remove the standard. Try again.", "error");
        return;
      }
      setConfirmingRemove(false);
      onUpdated(body);
      showToast(`${clauseLabel(standard.clause_type)} removed. Restore it from Removed standards.`);
    } finally {
      setRemoving(false);
    }
  }

  function cancel() {
    setForm(formOf(standard));
    setEditing(false);
    setError("");
  }

  const meta = [
    `Source: ${PROVENANCE_LABEL[standard.provenance]}`,
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
    <div
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", standard.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(dragging && "opacity-40")}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--cd-blue)] sm:cursor-grab"
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
        <Meta as="span" className={cn(LABEL_CLASSES, "mt-0.5 shrink-0")} style={{ color: severityStyle.textColor }}>
          {severityStyle.label}
        </Meta>
      </button>

      {open && (
        <div className="px-5 pb-4 pl-10">
          {!editing ? (
            <div className="space-y-3">
              <Section label="Position">{standard.position}</Section>
              <CalculationUse clauseType={standard.clause_type} position={standard.position} />
              {isBusiness && (
                <>
                  <Section label="Fallback language">{standard.fallback_language}</Section>
                  <Section label="Compromise range">
                    {standard.compromise_range || <span className="text-[var(--text-muted)]">None set</span>}
                  </Section>
                </>
              )}
              <Section label="Walk-away">
                {standard.walk_away_condition || <span className="text-[var(--text-muted)]">None set</span>}
              </Section>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(true)}>
                  Remove
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
              <CalculationUse clauseType={standard.clause_type} position={form.position} />
              {form.category === "business" && (
                <>
                  <Field label="Fallback language">
                    <FieldTextarea
                      value={form.fallback_language}
                      onChange={(e) => setForm((f) => ({ ...f, fallback_language: e.target.value }))}
                      rows={4}
                    />
                  </Field>
                  <Field label="Compromise range" hint={COMPROMISE_HINT}>
                    <FieldTextarea
                      value={form.compromise_range}
                      onChange={(e) => setForm((f) => ({ ...f, compromise_range: e.target.value }))}
                      rows={2}
                      placeholder="Leave blank if none"
                    />
                  </Field>
                </>
              )}
              <Field label="Walk-away condition">
                <FieldTextarea
                  value={form.walk_away_condition}
                  onChange={(e) => setForm((f) => ({ ...f, walk_away_condition: e.target.value }))}
                  rows={2}
                  placeholder="Leave blank if none"
                />
              </Field>
              <div className="flex flex-wrap gap-4">
                <Field label="Category">
                  <FieldSelect
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
                  >
                    {CATEGORY_KEYS.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_STYLE[c].name}
                      </option>
                    ))}
                  </FieldSelect>
                </Field>
                <Field label="Severity default">
                  <FieldSelect
                    value={form.severity_default}
                    onChange={(e) => setForm((f) => ({ ...f, severity_default: e.target.value as StandardRow["severity_default"] }))}
                  >
                    {SEVERITY_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {SEVERITY_NAME[s]}
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
                        {PROVENANCE_LABEL[p]}
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

      <DialogShell
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title={`Remove ${clauseLabel(standard.clause_type)}?`}
        maxWidth="md"
        dismissible={!removing}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)} disabled={removing}>
              Cancel
            </Button>
            <Button size="sm" onClick={remove} loading={removing} loadingText="Removing...">
              Remove
            </Button>
          </>
        }
      >
        <Body as="p" className="text-[var(--text-secondary)]">
          Reviews from now on won&apos;t check contracts against it. Past reviews keep their findings. You can
          restore it from Removed standards at the bottom of this page.
        </Body>
      </DialogShell>
    </div>
  );
}

function formOf(s: StandardRow) {
  return {
    category: s.category,
    position: s.position,
    fallback_language: s.fallback_language,
    walk_away_condition: s.walk_away_condition,
    severity_default: s.severity_default,
    compromise_range: s.compromise_range,
    provenance: s.provenance,
  };
}

/**
 * The number the app's dollar figures and checks take from this standard's
 * wording, or a warning when the wording no longer states one. Four standards
 * carry such a number. Every other standard shows nothing here.
 */
function CalculationUse({ clauseType, position }: { clauseType: string; position: string }) {
  const sources = POSITION_SOURCES.filter((source) => source.clause_type === clauseType);
  if (sources.length === 0) return null;

  const percent = (fraction: number) => `${Number((fraction * 100).toFixed(4))}%`;
  return (
    <div className="space-y-1">
      {sources.map((source) => {
        const value = readPosition(source, position);
        return value !== null ? (
          <Meta key={source.key} as="p" className="text-[var(--text-secondary)]">
            <span className="font-semibold">Used in calculations:</span> {percent(value)}, the {source.label}. The app reads it from the
            wording above.
          </Meta>
        ) : (
          <Meta key={source.key} as="p" role="alert" className="text-[var(--severity-high)]">
            The app can&apos;t read the {source.label} from this wording, so its calculations keep using{" "}
            {percent(DEFAULT_POSITIONS[source.key])}. To change that number, state it in words like &ldquo;{source.example}&rdquo;.
          </Meta>
        );
      })}
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
