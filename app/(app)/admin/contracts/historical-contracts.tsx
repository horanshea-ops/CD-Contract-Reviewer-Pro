"use client";

import { useState } from "react";
import { ContractDropZone } from "@/components/contract-drop-zone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { Body, Meta, Subtitle } from "@/components/ui/typography";
import { TIER_LABELS } from "@/lib/analytics/types";
import type { HistoricalContract } from "@/lib/historical/types";

interface AssociateOption {
  id: string;
  name: string;
  active: boolean;
}

const STATUS: Record<HistoricalContract["extraction_status"], { label: string; className: string }> = {
  stored: { label: "Stored", className: "bg-[var(--surface-muted)] text-[var(--text-secondary)]" },
  pending: { label: "Reading terms", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  done: { label: "Terms read", className: "bg-[var(--status-success-bg)] text-[var(--status-success)]" },
  failed: { label: "Couldn't read terms", className: "bg-[var(--severity-high-bg)] text-[var(--severity-high)]" },
  blocked_ai_clause: { label: "Restricts AI review", className: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium)]" },
};

const EMPTY = {
  hotel_name: "",
  brand: "",
  parent_company: "",
  city: "",
  state: "",
  country: "United States",
  market_tier: "",
  client_name: "",
  negotiated_by: "",
  event_start: "",
  event_end: "",
  signed_at: "",
};

const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function HistoricalContracts({
  initial,
  associates,
  extractionOn,
}: {
  initial: HistoricalContract[];
  associates: AssociateOption[];
  extractionOn: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<HistoricalContract | null>(null);
  const [formKey, setFormKey] = useState(0);
  const { showToast } = useToast();

  const set = (field: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a contract file.");
    setSaving(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    for (const [key, value] of Object.entries(form)) body.append(key, value);
    const res = await fetch("/api/admin/historical", { method: "POST", body }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(json?.error || "The upload didn't go through. Try again.");
    setRows((prev) => [json as HistoricalContract, ...prev]);
    setFile(null);
    setForm((f) => ({ ...EMPTY, country: f.country }));
    setFormKey((k) => k + 1);
    showToast(`${json.hotel_name} added.`);
  }

  async function extract(row: HistoricalContract, proceed = false) {
    const res = await fetch(`/api/admin/historical/${row.id}/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proceed }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok) return showToast(json?.error || "Couldn't start. Try again.", "error");
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, extraction_status: "pending" } : r)));
    showToast("Reading its terms. Refresh in a minute to see the result.");
  }

  async function remove(row: HistoricalContract) {
    const res = await fetch(`/api/admin/historical/${row.id}`, { method: "DELETE" }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok) return showToast(json?.error || "Couldn't remove it. Try again.", "error");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setRemoving(null);
    showToast(`${row.hotel_name} removed.`);
  }

  return (
    <div className="space-y-8">
      <Card padding="lg">
        <Subtitle className="text-[var(--text-primary)] mb-1">Upload a past contract</Subtitle>
        <Body as="p" className="text-[var(--text-secondary)] mb-5">
          Signed contracts from before the tool feed the Analytics tab.{" "}
          {extractionOn
            ? "The tool reads each contract's terms after upload, at about 8¢ a contract."
            : "Reading their terms is switched off until CD's own Anthropic account is set up, so for now the tool stores each file with the details you enter."}
        </Body>

        <form key={formKey} onSubmit={upload} className="space-y-4">
          <ContractDropZone
            id="historical-file"
            file={file}
            onFile={(picked) => {
              setFile(picked);
              if (picked) setError("");
            }}
            onError={setError}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hotel">
              <FieldInput value={form.hotel_name} onChange={set("hotel_name")} placeholder="e.g. Hilton Downtown Denver" required />
            </Field>
            <Field label="Brand">
              <FieldInput value={form.brand} onChange={set("brand")} placeholder="e.g. Hilton" required />
            </Field>
            <Field label="Parent company" hint="(optional)">
              <FieldInput value={form.parent_company} onChange={set("parent_company")} placeholder="e.g. Hilton Worldwide" />
            </Field>
            <Field label="Market tier">
              <FieldSelect value={form.market_tier} onChange={set("market_tier")} required>
                <option value="" disabled>
                  Choose a tier…
                </option>
                {Object.entries(TIER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label="City">
              <FieldInput value={form.city} onChange={set("city")} required />
            </Field>
            <Field label="State or province">
              <FieldInput value={form.state} onChange={set("state")} placeholder="e.g. CO" />
            </Field>
            <Field label="Country">
              <FieldInput value={form.country} onChange={set("country")} />
            </Field>
            <Field label="Client">
              <FieldInput value={form.client_name} onChange={set("client_name")} placeholder="e.g. Acme Association" required />
            </Field>
            <Field label="Negotiated by" hint="(optional)">
              <FieldSelect value={form.negotiated_by} onChange={set("negotiated_by")}>
                <option value="">Not recorded</option>
                {associates.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.active ? "" : " (revoked)"}
                  </option>
                ))}
              </FieldSelect>
            </Field>
            <Field label="Signed on">
              <FieldInput type="date" value={form.signed_at} onChange={set("signed_at")} required />
            </Field>
            <Field label="Event starts" hint="(optional)">
              <FieldInput type="date" value={form.event_start} onChange={set("event_start")} />
            </Field>
            <Field label="Event ends" hint="(optional)">
              <FieldInput type="date" value={form.event_end} onChange={set("event_end")} />
            </Field>
          </div>

          <Button type="submit" size="lg" fullWidth disabled={!file} loading={saving} loadingText="Uploading...">
            Upload contract
          </Button>
          {error && (
            <Body as="p" role="alert" className="text-[var(--severity-high)]">
              {error}
            </Body>
          )}
        </form>
      </Card>

      <section>
        <Subtitle className="text-[var(--text-primary)] mb-2">Uploaded contracts · {rows.length}</Subtitle>
        {rows.length === 0 ? (
          <Body as="p" className="text-[var(--text-secondary)]">
            None yet. Each one you upload appears here and in the Analytics tab.
          </Body>
        ) : (
          <Card padding="none" className="overflow-hidden divide-y divide-[var(--border)]">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <Body as="span" className="block font-medium text-[var(--text-primary)]">
                    {r.hotel_name}
                  </Body>
                  <Meta as="span" className="block text-[var(--text-secondary)]">
                    {[r.brand, [r.city, r.state].filter(Boolean).join(", "), r.client_name, `signed ${date(r.signed_at)}`].join(" · ")}
                  </Meta>
                </div>
                <StatusPill label={STATUS[r.extraction_status].label} className={STATUS[r.extraction_status].className} />
                <div className="flex items-center gap-3 text-sm">
                  <a href={`/api/historical/${r.id}/file`} target="_blank" rel="noopener" className="text-[var(--cd-navy)] underline underline-offset-2">
                    Open file
                  </a>
                  {extractionOn && r.extraction_status === "failed" && (
                    <button type="button" onClick={() => extract(r)} className="text-[var(--cd-navy)] underline underline-offset-2">
                      Read terms again
                    </button>
                  )}
                  {extractionOn && r.extraction_status === "blocked_ai_clause" && (
                    <button type="button" onClick={() => extract(r, true)} className="text-[var(--cd-navy)] underline underline-offset-2">
                      Read terms anyway
                    </button>
                  )}
                  <button type="button" onClick={() => setRemoving(r)} className="text-[var(--text-secondary)] underline underline-offset-2">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      <DialogShell
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.hotel_name ?? "this contract"}?`}
        maxWidth="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => removing && remove(removing)}>
              Remove
            </Button>
          </>
        }
      >
        <Body as="p" className="text-[var(--text-secondary)]">
          This deletes the stored file and its terms, and takes it out of the Analytics tab. It can&apos;t be undone.
        </Body>
      </DialogShell>
    </div>
  );
}
