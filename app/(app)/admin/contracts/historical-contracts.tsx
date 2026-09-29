"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ContractDropZone, sortContractFiles } from "@/components/contract-drop-zone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { Body, Meta, Subtitle } from "@/components/ui/typography";
import { TIER_LABELS } from "@/lib/analytics/types";
import { cn } from "@/lib/cn";
import { needsALook } from "@/lib/historical/details";
import type { HistoricalContract } from "@/lib/historical/types";

interface AssociateOption {
  id: string;
  name: string;
  active: boolean;
}

type Row = HistoricalContract;
type Filter = "all" | "waiting" | "reading" | "look" | "ready";

const UPLOADS_AT_ONCE = 3;
const PAGE = 50;
const CENTS_EACH = 4;

/** Where a contract stands, in the admin's terms. */
function standing(r: Row): Exclude<Filter, "all"> {
  if (r.extraction_status === "waiting" || r.extraction_status === "stored") return "waiting";
  if (r.extraction_status === "reading" || r.extraction_status === "pending") return "reading";
  if (r.extraction_status === "done" && !needsALook(r)) return "ready";
  return "look";
}

const STANDING: Record<Exclude<Filter, "all">, { label: string; className: string }> = {
  waiting: { label: "Waiting to be read", className: "bg-[var(--surface-muted)] text-[var(--text-secondary)]" },
  reading: { label: "Being read", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  look: { label: "Needs a look", className: "bg-[var(--severity-medium-bg)] text-[var(--severity-medium)]" },
  ready: { label: "Ready", className: "bg-[var(--status-success-bg)] text-[var(--status-success)]" },
};

/** Why a contract needs a look, in one line. */
function lookReason(r: Row): string {
  if (r.extraction_status === "blocked_ai_clause") return "The contract restricts AI-assisted review.";
  if (r.extraction_status === "failed") return "It couldn't be read.";
  const missing = [
    !r.hotel_name && "hotel",
    !r.city && "city",
    !r.signed_at && "signed date",
    !r.market_tier && "market tier",
  ].filter(Boolean);
  return `Missing ${missing.join(", ")}.`;
}

const date = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

interface UploadProgress {
  total: number;
  done: number;
  added: number;
  duplicates: string[];
  failed: { name: string; reason: string }[];
}

export default function HistoricalContracts({
  initial,
  associates,
  extractionOn,
}: {
  initial: Row[];
  associates: AssociateOption[];
  extractionOn: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [editing, setEditing] = useState<Row | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [sending, setSending] = useState<{ sent: number } | null>(null);
  const checked = useRef(false);
  const { showToast } = useToast();

  // A refresh after results arrive brings a new list from the server.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setRows(initial);
  }

  const counts = useMemo(() => {
    const tally: Record<Filter, number> = { all: rows.length, waiting: 0, reading: 0, look: 0, ready: 0 };
    for (const r of rows) tally[standing(r)]++;
    return tally;
  }, [rows]);

  // Results from a finished batch are collected whenever the page opens.
  useEffect(() => {
    if (checked.current || counts.reading === 0) return;
    checked.current = true;
    fetch("/api/admin/historical/batch")
      .then((res) => res.json())
      .then((body) => {
        if (body.collected > 0) {
          showToast(`${body.collected} contracts read.`);
          router.refresh();
        }
      })
      .catch(() => {});
  }, [counts.reading, router, showToast]);

  const visible = useMemo(() => rows.filter((r) => filter === "all" || standing(r) === filter), [rows, filter]);

  function replace(row: Row) {
    setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
  }

  async function uploadAll(files: File[]) {
    const { accepted, rejected } = sortContractFiles(files);
    const state: UploadProgress = { total: files.length, done: rejected.length, added: 0, duplicates: [], failed: [...rejected] };
    setProgress({ ...state });

    const queue = [...accepted];
    async function worker() {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/admin/historical", { method: "POST", body }).catch(() => null);
        const json = await res?.json().catch(() => null);
        if (res?.status === 201) {
          state.added++;
          setRows((prev) => [json as Row, ...prev]);
        } else if (json?.duplicate) {
          state.duplicates.push(file.name);
        } else {
          state.failed.push({ name: file.name, reason: json?.error || "The upload didn't go through." });
        }
        state.done++;
        setProgress({ ...state, duplicates: [...state.duplicates], failed: [...state.failed] });
      }
    }
    await Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, worker));
  }

  async function sendWaiting() {
    let sent = 0;
    setSending({ sent });
    try {
      for (;;) {
        const res = await fetch("/api/admin/historical/batch", { method: "POST" }).catch(() => null);
        const json = await res?.json().catch(() => null);
        if (!res?.ok) {
          showToast(json?.error || "Couldn't send the contracts to be read. Try again.", "error");
          break;
        }
        sent += json.sent;
        setSending({ sent });
        if (json.sent === 0 || json.remaining === 0) break;
      }
      if (sent > 0) showToast(`${sent} contracts sent to be read. Results usually arrive within the hour.`);
      router.refresh();
    } finally {
      setSending(null);
    }
  }

  async function queueAgain(row: Row, proceed = false) {
    const res = await fetch(`/api/admin/historical/${row.id}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proceed }),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok) return showToast(json?.error || "Couldn't do that. Try again.", "error");
    replace(json as Row);
    showToast("Back in line to be read.");
  }

  async function remove(row: Row) {
    const res = await fetch(`/api/admin/historical/${row.id}`, { method: "DELETE" }).catch(() => null);
    const json = await res?.json().catch(() => null);
    if (!res?.ok) return showToast(json?.error || "Couldn't remove it. Try again.", "error");
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setRemoving(null);
    showToast(`${row.hotel_name ?? row.file_name} removed.`);
  }

  const uploading = progress !== null && progress.done < progress.total;

  return (
    <div className="space-y-8">
      <Card padding="lg">
        <Subtitle className="text-[var(--text-primary)] mb-1">Upload past contracts</Subtitle>
        <Body as="p" className="text-[var(--text-secondary)] mb-5">
          Signed contracts from before the tool feed the Analytics tab. Drop as many as you have. The hotel, client, dates and
          terms are read from each contract, so there&apos;s nothing to fill in.
        </Body>

        <ContractDropZone id="historical-files" label="Contracts" onFiles={uploadAll} />

        {progress && (
          <div className="mt-4 space-y-1" aria-live="polite">
            <Body as="p" className="text-[var(--text-primary)]">
              {uploading ? `Uploading ${progress.done} of ${progress.total}…` : `Finished: ${progress.total} files.`}{" "}
              {progress.added} added
              {progress.duplicates.length > 0 && `, ${progress.duplicates.length} already uploaded`}
              {progress.failed.length > 0 && `, ${progress.failed.length} skipped`}.
            </Body>
            {progress.failed.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">Which were skipped</summary>
                <ul className="mt-1 space-y-0.5">
                  {progress.failed.map((f) => (
                    <li key={f.name}>
                      <Meta as="span" className="text-[var(--text-secondary)]">
                        {f.name}: {f.reason}
                      </Meta>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Card>

      {(counts.waiting > 0 || counts.reading > 0) && (
        <Card padding="lg" className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1 basis-64">
            {counts.waiting > 0 && (
              <Body as="p" className="text-[var(--text-primary)]">
                {counts.waiting} {counts.waiting === 1 ? "contract is" : "contracts are"} waiting to be read.
                {extractionOn && ` Reading them costs about $${((counts.waiting * CENTS_EACH) / 100).toFixed(2)}.`}
              </Body>
            )}
            {counts.reading > 0 && (
              <Meta as="p" className="text-[var(--text-secondary)]">
                {counts.reading} being read. Results usually arrive within the hour, and this page collects them when it opens.
              </Meta>
            )}
          </div>
          {extractionOn && counts.waiting > 0 && (
            <Button onClick={sendWaiting} loading={!!sending} loadingText={`Sending${sending?.sent ? ` (${sending.sent})` : ""}...`}>
              Read waiting contracts
            </Button>
          )}
        </Card>
      )}

      <section>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show contracts">
          {(["all", "waiting", "reading", "look", "ready"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setFilter(f);
                setShown(PAGE);
              }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                filter === f ? "bg-[var(--cd-navy)] text-white" : "bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              {f === "all" ? "All" : STANDING[f].label} · {counts[f]}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <Body as="p" className="text-[var(--text-secondary)]">
            {rows.length === 0 ? "None yet. Each contract you upload appears here." : "No contracts here."}
          </Body>
        ) : (
          <Card padding="none" className="overflow-hidden divide-y divide-[var(--border)]">
            {visible.slice(0, shown).map((r) => {
              const s = standing(r);
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                  <div className="min-w-0 flex-1 basis-60">
                    <Body as="span" className="block truncate font-medium text-[var(--text-primary)]">
                      {r.hotel_name ?? r.file_name}
                    </Body>
                    <Meta as="span" className="block truncate text-[var(--text-secondary)]">
                      {s === "look"
                        ? lookReason(r)
                        : [r.brand, [r.city, r.state].filter(Boolean).join(", "), r.client_name, r.signed_at && `signed ${date(r.signed_at)}`]
                            .filter(Boolean)
                            .join(" · ") || r.file_name}
                    </Meta>
                  </div>
                  <StatusPill label={STANDING[s].label} className={STANDING[s].className} />
                  <div className="flex items-center gap-3 text-sm">
                    <button type="button" onClick={() => setEditing(r)} className="text-[var(--cd-navy)] underline underline-offset-2">
                      Edit
                    </button>
                    <a href={`/api/historical/${r.id}/file`} target="_blank" rel="noopener" className="text-[var(--cd-navy)] underline underline-offset-2">
                      Open
                    </a>
                    {r.extraction_status === "failed" && (
                      <button type="button" onClick={() => queueAgain(r)} className="text-[var(--cd-navy)] underline underline-offset-2">
                        Read again
                      </button>
                    )}
                    {r.extraction_status === "blocked_ai_clause" && (
                      <button type="button" onClick={() => queueAgain(r, true)} className="text-[var(--cd-navy)] underline underline-offset-2">
                        Read anyway
                      </button>
                    )}
                    <button type="button" onClick={() => setRemoving(r)} className="text-[var(--text-secondary)] underline underline-offset-2">
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
        {visible.length > shown && (
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, visible.length - shown)} more
          </Button>
        )}
      </section>

      {editing && (
        <EditDialog
          row={editing}
          associates={associates}
          onClose={() => setEditing(null)}
          onSaved={(row) => {
            replace(row);
            setEditing(null);
            showToast("Saved.");
          }}
        />
      )}

      <DialogShell
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.hotel_name ?? removing?.file_name ?? "this contract"}?`}
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

const PROVENANCE_LABEL: Record<string, string> = {
  checked: "Read from the contract",
  guessed: "Guessed from the brand",
  edited: "Entered by an admin",
};

function EditDialog({
  row,
  associates,
  onClose,
  onSaved,
}: {
  row: Row;
  associates: AssociateOption[];
  onClose: () => void;
  onSaved: (row: Row) => void;
}) {
  const [form, setForm] = useState({
    hotel_name: row.hotel_name ?? "",
    brand: row.brand ?? "",
    parent_company: row.parent_company ?? "",
    market_tier: row.market_tier ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    country: row.country ?? "",
    client_name: row.client_name ?? "",
    negotiated_by: row.negotiated_by ?? "",
    signed_at: row.signed_at ?? "",
    event_start: row.event_start ?? "",
    event_end: row.event_end ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const hint = (field: keyof typeof form) => {
    const how = row.details_checked?.[field];
    return how ? PROVENANCE_LABEL[how] : undefined;
  };

  async function save() {
    const changed = Object.fromEntries(
      Object.entries(form).filter(([field, value]) => value !== ((row[field as keyof Row] as string | null) ?? ""))
    );
    if (Object.keys(changed).length === 0) return onClose();
    setSaving(true);
    setError("");
    const res = await fetch(`/api/admin/historical/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changed),
    }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setSaving(false);
    if (!res?.ok) return setError(json?.error || "Couldn't save. Try again.");
    onSaved(json as Row);
  }

  return (
    <DialogShell
      open
      onClose={onClose}
      title={row.hotel_name ?? row.file_name}
      maxWidth="2xl"
      scrollBody
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={saving} loadingText="Saving...">
            Save
          </Button>
        </>
      }
    >
      <Meta as="p" className="text-[var(--text-secondary)] mb-3">
        {row.file_name}. Fix anything read wrongly. Analytics counts a contract once it has a hotel, city, signed date and market
        tier.
      </Meta>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Hotel" hint={hint("hotel_name")}>
          <FieldInput value={form.hotel_name} onChange={set("hotel_name")} />
        </Field>
        <Field label="Brand" hint={hint("brand")}>
          <FieldInput value={form.brand} onChange={set("brand")} placeholder="Leave blank if independent" />
        </Field>
        <Field label="Parent company" hint={hint("parent_company")}>
          <FieldInput value={form.parent_company} onChange={set("parent_company")} />
        </Field>
        <Field label="Market tier" hint={hint("market_tier")}>
          <FieldSelect value={form.market_tier} onChange={set("market_tier")}>
            <option value="">Not known</option>
            {Object.entries(TIER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label="City" hint={hint("city")}>
          <FieldInput value={form.city} onChange={set("city")} />
        </Field>
        <Field label="State or province" hint={hint("state")}>
          <FieldInput value={form.state} onChange={set("state")} />
        </Field>
        <Field label="Country" hint={hint("country")}>
          <FieldInput value={form.country} onChange={set("country")} />
        </Field>
        <Field label="Client" hint={hint("client_name")}>
          <FieldInput value={form.client_name} onChange={set("client_name")} />
        </Field>
        <Field label="Negotiated by" hint={hint("negotiated_by")}>
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
        <Field label="Signed on" hint={hint("signed_at")}>
          <FieldInput type="date" value={form.signed_at} onChange={set("signed_at")} />
        </Field>
        <Field label="Event starts" hint={hint("event_start")}>
          <FieldInput type="date" value={form.event_start} onChange={set("event_start")} />
        </Field>
        <Field label="Event ends" hint={hint("event_end")}>
          <FieldInput type="date" value={form.event_end} onChange={set("event_end")} />
        </Field>
      </div>
      {error && (
        <Meta as="p" role="alert" className="mt-3 text-[var(--severity-high)]">
          {error}
        </Meta>
      )}
    </DialogShell>
  );
}
