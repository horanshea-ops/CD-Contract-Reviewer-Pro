"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DialogShell } from "@/components/ui/dialog-shell";
import { FIELD_LABEL_CLASSES } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { Body } from "@/components/ui/typography";
import type { StandardSet } from "@/lib/standards/sets";

/**
 * Which set of standards the screen shows, and whether reviews read it.
 *
 * A set is the whole library for its brand's reviews once it is switched on,
 * so the switch says how many standards that is and asks first. An empty set
 * has nothing to switch on, and is offered a copy of the default set instead.
 */
export function StandardsSetBar<Row>({
  sets,
  set,
  count,
  hasRemoved,
  onSwitched,
  onCopied,
}: {
  sets: StandardSet[];
  set: StandardSet;
  /** Standards in use in this set. */
  count: number;
  /** Whether the set holds removed standards, which a copy would collide with. */
  hasRemoved: boolean;
  onSwitched: (set: StandardSet) => void;
  onCopied: (rows: Row[]) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const fallback = sets.find((s) => s.is_default) ?? set;
  const standards = `${count} standard${count === 1 ? "" : "s"}`;

  async function switchTo(is_active: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/standard-sets/${set.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        showToast(body?.error || "Could not save. Try again.", "error");
        return;
      }
      setConfirming(false);
      onSwitched(body);
      showToast(is_active ? `${set.name} is on.` : `${set.name} is off.`);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/standard-sets/${set.key}`, { method: "POST" }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        showToast(body?.error || "Could not copy the standards. Try again.", "error");
        return;
      }
      onCopied(body.standards);
      showToast(`Copied ${body.standards.length} standards from ${fallback.name}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6">
      <label htmlFor="standards-set" className={FIELD_LABEL_CLASSES}>
        Standards set
      </label>
      <select
        id="standards-set"
        value={set.key}
        onChange={(e) => router.push(`/admin/standards?set=${e.target.value}`)}
        className="w-full sm:w-64 rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
      >
        {sets.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
            {s.is_default ? " (all other hotels)" : s.is_active ? "" : " (off)"}
          </option>
        ))}
      </select>

      {!set.is_default && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-[var(--surface-muted)] px-3 py-2.5">
          <Body as="p" className="flex-1 min-w-[16rem] text-[var(--text-primary)]">
            {set.is_active
              ? `Reviews of ${set.name} contracts read these ${standards} and nothing from ${fallback.name}.`
              : count === 0
                ? `${set.name} has no standards yet, so reviews of ${set.name} contracts use ${fallback.name}.`
                : `${set.name} is off, so reviews of ${set.name} contracts use ${fallback.name}.`}
          </Body>

          {set.is_active && (
            <Button variant="secondary" size="sm" onClick={() => switchTo(false)} loading={busy} loadingText="Saving...">
              Switch off
            </Button>
          )}
          {!set.is_active && count > 0 && (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Switch on
            </Button>
          )}
          {count === 0 && !hasRemoved && (
            <Button size="sm" onClick={copy} loading={busy} loadingText="Copying...">
              Copy {fallback.name}&apos;s standards
            </Button>
          )}
        </div>
      )}

      <DialogShell
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Switch ${set.name} on?`}
        maxWidth="md"
        dismissible={!busy}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => switchTo(true)} loading={busy} loadingText="Saving...">
              Switch on
            </Button>
          </>
        }
      >
        <Body as="p" className="text-[var(--text-secondary)]">
          Reviews of {set.name} contracts will read these {standards} and nothing from {fallback.name}. A clause with
          no standard here won&apos;t be checked. Reviews already run keep their findings.
        </Body>
      </DialogShell>
    </div>
  );
}
