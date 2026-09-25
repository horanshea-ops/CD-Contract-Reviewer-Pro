"use client";

import { useState } from "react";
import { toNotes } from "@/lib/document-notes";
import { Body, Meta } from "@/components/ui/typography";

/**
 * The model's notes on the document, one line each.
 *
 * Each headline is a sentence the associate can take in at a glance, and
 * "More" opens the detail behind it. Internal to CD, like every finding
 * detail: nothing here reaches the property.
 */
export default function DocumentNotes({ notes }: { notes: unknown }) {
  const items = toNotes(notes);
  const [open, setOpen] = useState<Set<number>>(new Set());
  if (items.length === 0) return null;

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section aria-label="Notes on this document" className="rounded-lg border border-[var(--border)] bg-white px-4 py-3">
      <Meta as="h2" className="font-semibold uppercase tracking-wide mb-1 text-[var(--text-secondary)]">
        Notes on this document ({items.length})
      </Meta>
      <ul className="space-y-1.5">
        {items.map((note, i) => (
          <li key={i}>
            <Body as="p" className="text-[var(--text-primary)]">
              {note.headline}
              {note.detail && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    aria-expanded={open.has(i)}
                    className="text-xs text-[var(--cd-navy)] hover:underline"
                  >
                    {open.has(i) ? "Less" : "More"}
                  </button>
                </>
              )}
            </Body>
            {note.detail && open.has(i) && (
              <Meta as="p" className="text-[var(--text-secondary)] mt-0.5">
                {note.detail}
              </Meta>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
