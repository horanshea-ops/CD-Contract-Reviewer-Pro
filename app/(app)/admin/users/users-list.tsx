"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogShell } from "@/components/ui/dialog-shell";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { Body, Meta } from "@/components/ui/typography";
import type { AssociateRow } from "@/lib/associates";
import { cn } from "@/lib/cn";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function UsersList({
  initial,
  lastSignIn,
  selfId,
}: {
  initial: AssociateRow[];
  lastSignIn: Record<string, string>;
  selfId: string;
}) {
  const [people, setPeople] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AssociateRow | null>(null);
  const { showToast } = useToast();

  const active = people.filter((p) => p.status === "active");
  const revoked = people.filter((p) => p.status === "revoked");

  function replace(row: AssociateRow) {
    setPeople((prev) => prev.map((p) => (p.id === row.id ? row : p)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Body as="p" className="text-[var(--text-secondary)]">
          {active.length} active{revoked.length ? `, ${revoked.length} revoked` : ""}.
        </Body>
        <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>
          Add associate
        </Button>
      </div>

      <Card padding="none" className="overflow-hidden divide-y divide-[var(--border)]">
        {[...active, ...revoked].map((p) => (
          <div key={p.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3", p.status === "revoked" && "opacity-60")}>
            <div className="min-w-0 flex-1 basis-56">
              <Body as="span" className="block font-medium text-[var(--text-primary)]">
                {p.name}
                {p.id === selfId && <span className="font-normal text-[var(--text-muted)]"> (you)</span>}
              </Body>
              <Meta as="span" className="block truncate text-[var(--text-secondary)]">
                {p.email}
              </Meta>
            </div>
            <div className="flex items-center gap-2">
              {p.is_admin && <StatusPill label="Admin" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" />}
              {p.status === "revoked" && (
                <StatusPill label="Revoked" className="bg-[var(--surface-muted)] text-[var(--text-secondary)]" />
              )}
            </div>
            <Meta as="span" className="w-40 text-[var(--text-muted)]">
              {lastSignIn[p.id] ? `Last signed in ${date(lastSignIn[p.id])}` : "Never signed in"}
            </Meta>
            <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>
              Edit
            </Button>
          </div>
        ))}
      </Card>

      <AddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(row) => {
          setPeople((prev) => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
          setAdding(false);
          showToast(`${row.name} added. They can sign in now.`);
        }}
      />
      {editing && (
        <EditDialog
          person={editing}
          isSelf={editing.id === selfId}
          onClose={() => setEditing(null)}
          onSaved={(row, message) => {
            replace(row);
            setEditing(null);
            showToast(message);
          }}
        />
      )}
    </div>
  );
}

async function send(url: string, method: "POST" | "PATCH", body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(
    () => null
  );
  const json = await res?.json().catch(() => null);
  return res?.ok ? { row: json as AssociateRow } : { error: (json?.error as string) || "Something went wrong. Try again." };
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (row: AssociateRow) => void }) {
  const [form, setForm] = useState({ name: "", email: "", is_admin: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setForm({ name: "", email: "", is_admin: false });
    setError("");
    onClose();
  }

  async function save() {
    setSaving(true);
    setError("");
    const result = await send("/api/admin/associates", "POST", form);
    setSaving(false);
    if (result.error) return setError(result.error);
    setForm({ name: "", email: "", is_admin: false });
    onAdded(result.row!);
  }

  return (
    <DialogShell
      open={open}
      onClose={close}
      title="Add an associate"
      maxWidth="md"
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={saving} loadingText="Adding...">
            Add associate
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Body as="p" className="text-[var(--text-secondary)]">
          They can sign in at the login page with this email as soon as you add them. The app doesn&apos;t send them an
          email, so let them know.
        </Body>
        <Field label="Name">
          <FieldInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Email">
          <FieldInput type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <Checkbox checked={form.is_admin} onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))} />
          Admin: can manage users and edit the standards library
        </label>
        {error && (
          <Meta as="p" role="alert" className="text-[var(--severity-high)]">
            {error}
          </Meta>
        )}
      </div>
    </DialogShell>
  );
}

function EditDialog({
  person,
  isSelf,
  onClose,
  onSaved,
}: {
  person: AssociateRow;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (row: AssociateRow, message: string) => void;
}) {
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.is_admin ? "admin" : "associate");
  const [saving, setSaving] = useState<"save" | "status" | null>(null);
  const [error, setError] = useState("");

  async function save() {
    setSaving("save");
    setError("");
    const result = await send(`/api/admin/associates/${person.id}`, "PATCH", { name, is_admin: role === "admin" });
    setSaving(null);
    if (result.error) return setError(result.error);
    onSaved(result.row!, `${result.row!.name} saved.`);
  }

  async function toggleAccess() {
    const status = person.status === "active" ? "revoked" : "active";
    setSaving("status");
    setError("");
    const result = await send(`/api/admin/associates/${person.id}`, "PATCH", { status });
    setSaving(null);
    if (result.error) return setError(result.error);
    onSaved(result.row!, status === "revoked" ? `${person.name} can no longer sign in.` : `${person.name} can sign in again.`);
  }

  return (
    <DialogShell
      open
      onClose={onClose}
      title={`Edit ${person.name}`}
      maxWidth="md"
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!!saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} loading={saving === "save"} loadingText="Saving...">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Meta as="p" className="text-[var(--text-secondary)]">
          {person.email}. The email can&apos;t change, because sign-in uses it. To change it, revoke this associate and
          add them again.
        </Meta>
        <Field label="Name">
          <FieldInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!isSelf && (
          <Field label="Role">
            <FieldSelect value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="associate">Associate</option>
              <option value="admin">Admin</option>
            </FieldSelect>
          </Field>
        )}
        {!isSelf && (
          <div className="rounded-md border border-[var(--border)] px-4 py-3">
            <Body as="p" className="text-[var(--text-primary)] mb-2">
              {person.status === "active"
                ? "Revoking signs them out and stops them signing in. Their reviews stay."
                : "Their access is revoked. Restoring it lets them sign in again."}
            </Body>
            <Button variant="secondary" size="sm" onClick={toggleAccess} loading={saving === "status"} loadingText="Saving...">
              {person.status === "active" ? "Revoke access" : "Restore access"}
            </Button>
          </div>
        )}
        {error && (
          <Meta as="p" role="alert" className="text-[var(--severity-high)]">
            {error}
          </Meta>
        )}
      </div>
    </DialogShell>
  );
}
