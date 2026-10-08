"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Body, Meta, Subtitle } from "@/components/ui/typography";
import type { StandardSet } from "@/lib/standards/sets";

/**
 * The brands a set covers, for an admin to read and change.
 *
 * The list alone decides which hotels' reviews read the set, so it is shown
 * in full, one brand to a row, beneath the set's standards. The set's own
 * name stays on it. The default set takes every hotel no list names, so it
 * has no list and no controls.
 */
export function BrandsCovered({ set, onChanged }: { set: StandardSet; onChanged: (set: StandardSet) => void }) {
  const { showToast } = useToast();
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  if (set.is_default) {
    return (
      <section className="mt-10">
        <Subtitle>Brands covered</Subtitle>
        <Body as="p" className="mt-2 text-[var(--text-secondary)]">
          {set.name} has no brand list. It covers every hotel whose brand isn&apos;t listed under another set.
        </Body>
      </section>
    );
  }

  async function save(brand_names: string[], done: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/standard-sets/${set.key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand_names }),
      }).catch(() => null);
      const body = await res?.json().catch(() => null);
      if (!res?.ok) {
        showToast(body?.error || "Could not save. Try again.", "error");
        return false;
      }
      onChanged(body);
      showToast(done);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = adding.replace(/\s+/g, " ").trim();
    if (!name) return;
    if (await save([...set.brand_names, name], `${name} added to ${set.name}.`)) setAdding("");
  }

  const isOwnName = (name: string) => name.trim().toLowerCase() === set.name.toLowerCase();

  return (
    <section className="mt-10">
      <Subtitle>Brands covered</Subtitle>
      <Meta as="p" className="mt-1 text-[var(--text-muted)]">
        The brands that count as {set.name}. Changes apply to negotiations started from now on.
      </Meta>

      <ul className="mt-3 max-w-xl divide-y divide-[var(--border)] rounded-md border border-[var(--border-strong)] bg-[var(--surface)]">
        {set.brand_names.map((name) => (
          <li key={name} className="flex items-center justify-between gap-3 px-3 py-2">
            <Body as="span" className="text-[var(--text-primary)]">
              {name}
            </Body>
            {isOwnName(name) ? (
              <Meta as="span" className="text-[var(--text-muted)]">
                Always on the list
              </Meta>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove ${name}`}
                disabled={busy}
                onClick={() =>
                  save(
                    set.brand_names.filter((kept) => kept !== name),
                    `${name} removed from ${set.name}.`
                  )
                }
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label={`Brand to add to ${set.name}`}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Add a brand, as a contract writes it"
          maxLength={80}
          className="w-full sm:w-72 rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
        />
        <Button type="submit" size="sm" disabled={!adding.trim()} loading={busy} loadingText="Saving...">
          Add
        </Button>
      </form>
    </section>
  );
}
