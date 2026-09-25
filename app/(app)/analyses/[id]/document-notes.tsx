"use client";

import { useState } from "react";
import { toNotes, type DocumentNote } from "@/lib/document-notes";
import { Body, Meta } from "@/components/ui/typography";

/**
 * Notes on the document itself, one bulleted line each.
 *
 * The app's own arithmetic checks come first and carry a "Checked" tag,
 * because they are certain where the model's notes are not. "More" opens the
 * detail behind a line. Internal to CD, like every finding detail: nothing
 * here reaches the property.
 */

type Note = DocumentNote & { source?: "check" };

/** How many lines the notes panel shows, for the overview's count. */
export function noteCount(notes: unknown, checks: DocumentNote[] = []): number {
  return toNotes(notes).length + checks.length;
}

export default function DocumentNotes({ notes, checks = [] }: { notes: unknown; checks?: DocumentNote[] }) {
  const items: Note[] = [...checks.map((c) => ({ ...c, source: "check" as const })), ...toNotes(notes)];
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
      <Meta as="h3" className="font-semibold uppercase tracking-wide mb-1.5 text-[var(--text-secondary)]">
        Notes on this document ({items.length})
      </Meta>
      <ul className="list-disc pl-5 space-y-1.5 marker:text-[var(--text-muted)]">
        {items.map((note, i) => (
          <li key={i}>
            <Body as="p" className="text-[var(--text-primary)]">
              {note.headline}
              {note.source === "check" && (
                <span className="ml-1.5 rounded bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] align-middle">
                  Checked
                </span>
              )}
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
