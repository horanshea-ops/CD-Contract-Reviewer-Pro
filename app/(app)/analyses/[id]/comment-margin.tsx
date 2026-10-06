"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { stackNotes, type CommentThread, type RevisionNote } from "@/lib/docx-preview";
import type { DocumentComment } from "@/lib/docx";
import { Body, Meta } from "@/components/ui/typography";

/**
 * The comments and tracked changes already in the file, set beside the wording
 * each belongs to, as Word shows them.
 *
 * Each note's wording carries a `data-anchors` attribute in the document. A
 * note sits level with that wording, or just below the note above it when the
 * two would overlap.
 */

export type MarginNote =
  | { key: string; kind: "comment"; number: number; thread: CommentThread<DocumentComment> }
  | { key: string; kind: "change"; change: RevisionNote };

const GAP = 8;

const CHANGE_VERB: Record<RevisionNote["kind"], string> = {
  added: "Added",
  deleted: "Deleted",
  replaced: "Replaced",
  moved: "Moved",
};

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const byline = (author: string, date: string) => [author || "Unnamed", shortDate(date)].filter(Boolean).join(" · ");

function Comment({ comment, clipped }: { comment: DocumentComment; clipped: boolean }) {
  return (
    <>
      <Meta as="span" className="block text-[var(--text-muted)]">
        {byline(comment.author, comment.date)}
      </Meta>
      <Body as="span" className={`block whitespace-pre-wrap ${clipped ? "line-clamp-4" : ""}`}>
        {comment.text}
      </Body>
    </>
  );
}

/** What one note says. The margin and the small-screen list both show it. */
export function NoteBody({ note, clipped }: { note: MarginNote; clipped: boolean }) {
  if (note.kind === "change") {
    const { change } = note;
    return (
      <>
        <Meta as="span" className="block text-[var(--text-muted)]">
          {byline(change.author, change.date)}
        </Meta>
        <Body as="span" className={`block whitespace-pre-wrap ${clipped ? "line-clamp-4" : ""}`}>
          <span className="font-semibold">{CHANGE_VERB[change.kind]}</span>{" "}
          {change.was && <span className="line-through text-[var(--text-muted)]">{change.was.trim()}</span>}
          {change.was && change.now && " with "}
          {change.now && <span>{change.now.trim()}</span>}
        </Body>
      </>
    );
  }

  const { root, replies } = note.thread;
  const resolved = root.resolved;
  return (
    <span className={resolved ? "block opacity-60" : "block"}>
      <Meta as="span" className="block font-semibold text-[var(--cd-navy)]">
        {note.number}
        {resolved && " · Resolved"}
      </Meta>
      <Comment comment={root} clipped={clipped} />
      {replies.map((reply) => (
        <span key={reply.id} className="mt-1.5 block border-l-2 border-[var(--border)] pl-2">
          <Comment comment={reply} clipped={clipped} />
        </span>
      ))}
    </span>
  );
}

export interface CommentMarginProps {
  notes: MarginNote[];
  /** The element that holds the document's wording, where each note's anchor is looked up. */
  anchorRoot: RefObject<HTMLElement | null>;
  activeKey: string | null;
  onSelect: (key: string) => void;
  /** Comments in the file beyond those shown. */
  notShown: number;
}

export function CommentMargin({ notes, anchorRoot, activeKey, onSelect, notShown }: CommentMarginProps) {
  const asideRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Map<string, number> | null>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const aside = asideRef.current;
    const root = anchorRoot.current;
    if (!aside || !root) return;

    const measure = () => {
      const base = aside.getBoundingClientRect().top;
      // A note whose wording isn't on screen follows the note before it.
      let last = 0;
      const measured = notes.flatMap((note) => {
        const el = aside.querySelector(`[data-note="${note.key}"]`);
        if (!el) return [];
        const anchor = root.querySelector(`[data-anchors~="${note.key}"]`);
        last = anchor ? anchor.getBoundingClientRect().top - base : last;
        return [{ key: note.key, anchorTop: Math.max(0, last), height: el.getBoundingClientRect().height }];
      });

      const next = stackNotes(measured, GAP);
      const bottom = Math.max(0, ...measured.map((m) => (next.get(m.key) ?? 0) + m.height));
      setTops((held) => (held && held.size === next.size && [...next].every(([key, top]) => held.get(key) === top) ? held : next));
      setHeight(bottom);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const el of aside.querySelectorAll("[data-note]")) observer.observe(el);
    return () => observer.disconnect();
  }, [notes, anchorRoot, activeKey]);

  return (
    <aside
      ref={asideRef}
      aria-label="Comments and tracked changes already in this file"
      className="relative hidden lg:block w-80 shrink-0 border-l border-[var(--border)] bg-[var(--surface-muted)]"
      style={{ minHeight: height + GAP + (notShown > 0 ? 40 : 0) }}
    >
      {notes.map((note) => {
        const active = note.key === activeKey;
        return (
          <button
            key={note.key}
            type="button"
            data-note={note.key}
            aria-pressed={active}
            onClick={() => onSelect(note.key)}
            className={`absolute left-2 right-2 rounded-md border bg-white px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)] ${
              active ? "z-10 border-[var(--cd-navy)] shadow-md" : "border-[var(--border)] hover:border-[var(--border-strong)]"
            }`}
            style={{ top: tops?.get(note.key) ?? 0, visibility: tops ? "visible" : "hidden" }}
          >
            <NoteBody note={note} clipped={!active} />
          </button>
        );
      })}
      {notShown > 0 && (
        <div className="absolute left-2 right-2" style={{ top: height + GAP }}>
          <Meta as="p" className="text-[var(--text-muted)]">
            {notShown} more comments in the file are not shown.
          </Meta>
        </div>
      )}
    </aside>
  );
}
