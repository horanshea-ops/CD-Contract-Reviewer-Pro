"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  commentThreads,
  rangeOrNearestWord,
  resolveHighlight,
  revisionNotes,
  segmentRun,
  type PreviewBlock,
  type PreviewMark,
  type PreviewPart,
  type PreviewRun,
} from "@/lib/docx-preview";
import type { DocumentComment } from "@/lib/docx";
import { Button } from "@/components/ui/button";
import { Body, Meta, ReadingText, Subtitle, Title } from "@/components/ui/typography";
import { titleCase } from "@/lib/format";
import { CommentMargin, NoteBody, type MarginNote } from "./comment-margin";

/** The mark for whatever the reader last pointed at: a finding's wording, or a comment's. */
const FOCUS = "focus";
const COMMENT_FOCUS_COLOR = "var(--cd-blue-pale)";

/** What every block needs to draw its marks. */
interface Marking {
  /** Marks by part name. */
  marks: Map<string, PreviewMark[]>;
  focusColor: string;
  /** The number shown at the end of each comment's wording, by mark key. */
  numbers: Map<string, number>;
  /** The tracked change each run belongs to. Empty outside the comment view. */
  changeOfRun: Map<PreviewRun, string>;
  /** The note last picked, in the margin or in the wording. */
  activeKey: string | null;
  onSelect: (key: string) => void;
}

const commentKey = (id: string) => `comment-${id}`;

const NO_CHANGES: ReturnType<typeof revisionNotes> = { notes: [], keyOfRun: new Map() };

export interface DocxPreviewProps {
  analysisId: string;
  hadExistingRevisions: boolean;
  existingRevisionAuthors: string[];
  existingRevisionCount: number;
  selectedFinding: { id: string; quoted_text: string | null } | null;
  highlightColor: string;
  /** Whether the file's own comments and tracked changes show beside the wording. */
  commentView: boolean;
  onCommentViewChange: (on: boolean) => void;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const HEADING_STEP: Record<HeadingLevel, { Text: typeof Title; className: string }> = {
  1: { Text: Title, className: "mt-4 mb-2" },
  2: { Text: Subtitle, className: "mt-4 mb-2" },
  3: { Text: Body, className: "font-semibold mt-3 mb-2" },
  4: { Text: Body, className: "font-semibold mt-3 mb-2" },
  5: { Text: Body, className: "font-medium mt-3 mb-2" },
  6: { Text: Body, className: "font-medium mt-3 mb-2" },
};

export default function DocxPreview({
  analysisId,
  hadExistingRevisions,
  existingRevisionAuthors,
  existingRevisionCount,
  selectedFinding,
  highlightColor,
  commentView,
  onCommentViewChange,
}: DocxPreviewProps) {
  const [parts, setParts] = useState<PreviewPart[] | null>(null);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  // The note last picked, and the finding selected at the time. Selecting another finding takes the focus back.
  // `pick` counts the picks, so picking the same note again scrolls back to it.
  const [picked, setPicked] = useState<{ key: string; findingId: string | null; pick: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError("");
      setParts(null);
      try {
        const res = await fetch(`/api/analyses/${analysisId}/preview`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(body.error || "Could not load the document preview.");
          return;
        }
        setParts(body.parts);
        setComments(body.comments ?? []);
        setCommentsTotal(body.commentsTotal ?? 0);
      } catch {
        if (!cancelled) setLoadError("Could not load the document preview.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const match = useMemo(() => {
    if (!parts || !selectedFinding?.quoted_text) return null;
    return resolveHighlight(parts, selectedFinding.quoted_text);
  }, [parts, selectedFinding]);

  const selectedFindingId = selectedFinding?.id ?? null;

  const changes = useMemo(() => (parts ? revisionNotes(parts) : NO_CHANGES), [parts]);

  // One note per comment thread and one per tracked change. Each thread is placed by its first comment's wording.
  const notes = useMemo<MarginNote[]>(
    () => [
      ...commentThreads(comments).map((thread, i) => ({ key: commentKey(thread.root.id), kind: "comment" as const, number: i + 1, thread })),
      ...changes.notes.map((change) => ({ key: change.key, kind: "change" as const, change })),
    ],
    [comments, changes]
  );

  const activeKey = commentView && picked && picked.findingId === selectedFindingId ? picked.key : null;

  const commentRange = useMemo(() => {
    const ranges = new Map<string, { part: string; start: number; end: number }>();
    if (!parts) return ranges;
    for (const note of notes) {
      if (note.kind !== "comment") continue;
      const { root } = note.thread;
      const text = parts.find((p) => p.part === root.part)?.text ?? "";
      ranges.set(note.key, { part: root.part, ...rangeOrNearestWord(text, root.start, root.end) });
    }
    return ranges;
  }, [parts, notes]);

  const focus = useMemo(() => {
    const comment = activeKey ? commentRange.get(activeKey) : undefined;
    if (comment) return { ...comment, color: COMMENT_FOCUS_COLOR };
    return match ? { part: match.part, start: match.start, end: match.end, color: highlightColor } : null;
  }, [activeKey, commentRange, match, highlightColor]);

  const marking = useMemo<Marking>(() => {
    const marks = new Map<string, PreviewMark[]>();
    const numbers = new Map<string, number>();
    const add = (part: string, mark: PreviewMark) => marks.set(part, [...(marks.get(part) ?? []), mark]);

    if (focus) add(focus.part, { key: FOCUS, start: focus.start, end: focus.end });
    if (commentView) {
      for (const note of notes) {
        const range = commentRange.get(note.key);
        if (note.kind !== "comment" || !range) continue;
        numbers.set(note.key, note.number);
        add(range.part, { key: note.key, start: range.start, end: range.end });
      }
    }
    return {
      marks,
      numbers,
      focusColor: focus?.color ?? highlightColor,
      changeOfRun: commentView ? changes.keyOfRun : NO_CHANGES.keyOfRun,
      activeKey,
      onSelect: (key) => setPicked((held) => ({ key, findingId: selectedFindingId, pick: (held?.pick ?? 0) + 1 })),
    };
  }, [focus, commentView, notes, commentRange, changes, activeKey, selectedFindingId, highlightColor]);

  // One scroll per pick. Two smooth scrolls started together cut each other short.
  useEffect(() => {
    const target = activeKey ? `[data-anchors~="${activeKey}"]` : focus ? "[data-preview-active-highlight]" : null;
    if (!target) return;
    containerRef.current?.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus, activeKey, picked?.pick]);

  const noteCount = commentsTotal + changes.notes.length;

  if (loadError) {
    return (
      <div className="p-6">
        <Body as="p" className="text-[var(--severity-high)]">
          {loadError}
        </Body>
      </div>
    );
  }

  if (!parts) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--cd-navy)]"
          role="status"
          aria-label="Loading document preview"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {(hadExistingRevisions || noteCount > 0) && (
        <div className="flex items-center justify-between gap-3 bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] px-4 py-2 shrink-0">
          <Meta as="span">
            {hadExistingRevisions &&
              `${existingRevisionCount} tracked change${existingRevisionCount === 1 ? "" : "s"} already in this file, by ${existingRevisionAuthors.join(", ")}`}
          </Meta>
          {noteCount > 0 && (
            <Button
              size="sm"
              variant={commentView ? "primary" : "secondary"}
              aria-pressed={commentView}
              onClick={() => onCommentViewChange(!commentView)}
              className={commentView ? "shrink-0" : "shrink-0 bg-white"}
            >
              {commentView ? "Hide" : "Show"} comments and changes ({noteCount})
            </Button>
          )}
        </div>
      )}
      {commentView && (
        <ol
          aria-label="Comments and tracked changes already in this file"
          className="lg:hidden shrink-0 max-h-[38%] overflow-auto border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2"
        >
          {notes.map((note) => (
            <li key={note.key}>
              <button
                type="button"
                onClick={() => marking.onSelect(note.key)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
              >
                <NoteBody note={note} clipped={note.key !== activeKey} />
              </button>
            </li>
          ))}
          {commentsTotal > comments.length && (
            <li>
              <Meta as="span" className="block px-2 py-1.5 text-[var(--text-muted)]">
                {commentsTotal - comments.length} more comments in the file are not shown.
              </Meta>
            </li>
          )}
        </ol>
      )}
      <div ref={containerRef} className="flex-1 overflow-auto bg-white">
        <div className="flex items-stretch">
          <div className="flex-1 min-w-0 px-6 py-4">
            {parts.map((part) => (
              <div key={part.part}>
                {part.part !== "document" && (
                  <Meta as="p" className="font-semibold text-[var(--text-muted)] mt-6 mb-2">
                    {titleCase(part.part)}
                  </Meta>
                )}
                {part.blocks.map((block, i) => (
                  <Block key={i} block={block} partName={part.part} marking={marking} />
                ))}
              </div>
            ))}
          </div>
          {commentView && (
            <CommentMargin
              notes={notes}
              anchorRoot={containerRef}
              activeKey={activeKey}
              onSelect={marking.onSelect}
              notShown={commentsTotal - comments.length}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Block({ block, partName, marking }: { block: PreviewBlock; partName: string; marking: Marking }) {
  if (block.kind === "table") {
    return (
      // A wide table scrolls sideways within the text column, so the margin never covers its last columns.
      <div className="my-3 overflow-x-auto">
        <table className="border-collapse w-full">
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.cells.map((cell, c) => (
                  <td key={c} className="border border-[var(--border)] p-1.5 align-top">
                    {cell.blocks.map((b, i) => (
                      <Block key={i} block={b} partName={partName} marking={marking} />
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const runs = <Runs runs={block.runs} partName={partName} marking={marking} />;

  if (block.kind === "heading") {
    const level = (block.level in HEADING_STEP ? block.level : 6) as HeadingLevel;
    const { Text, className } = HEADING_STEP[level];
    const tag = `h${level}` as HeadingTag;
    return (
      <Text as={tag} className={className}>
        {runs}
      </Text>
    );
  }

  if (block.kind === "list-item") {
    return (
      <div className="flex gap-2 mb-1" style={{ marginLeft: block.indent * 16 }}>
        <ReadingText as="span" className="text-[var(--text-secondary)] shrink-0">
          {block.marker}
        </ReadingText>
        <ReadingText as="span" className="whitespace-pre-wrap">
          {runs}
        </ReadingText>
      </div>
    );
  }

  return (
    <ReadingText as="p" className="whitespace-pre-wrap mb-2">
      {runs}
    </ReadingText>
  );
}

function Runs({ runs, partName, marking }: { runs: PreviewRun[]; partName: string; marking: Marking }) {
  const marks = marking.marks.get(partName) ?? [];

  return (
    <>
      {runs.map((run, i) => {
        if (run.kind === "break") return <br key={i} />;

        const revisionClass =
          run.revision?.kind === "del" || run.revision?.kind === "moveFrom"
            ? "line-through text-[var(--text-muted)]"
            : run.revision?.kind === "ins" || run.revision?.kind === "moveTo"
              ? "underline decoration-[var(--cd-blue)] bg-[var(--cd-blue-pale)]"
              : "";
        const title = run.revision ? `${run.revision.author || "Unknown"} ${run.revision.kind} ${run.revision.date}` : undefined;

        // In the comment view a tracked change is the anchor of its margin note, and picks that note when clicked.
        const change = marking.changeOfRun.get(run);
        const changeProps = change
          ? {
              "data-anchors": change,
              onClick: () => marking.onSelect(change),
              className: `${revisionClass} cursor-pointer rounded-sm ${change === marking.activeKey ? "outline outline-2 outline-[var(--cd-navy)]" : ""}`,
            }
          : { className: revisionClass };

        const range = run.range;
        if (!range || !marks.some((m) => m.start < range.end && m.end > range.start)) {
          return (
            <span key={i} title={title} {...changeProps}>
              {run.text}
            </span>
          );
        }

        // Each piece is covered by a fixed set of marks: the focus highlight, comment anchors, or both.
        return (
          <span key={i} title={title} {...changeProps}>
            {segmentRun({ text: run.text, range }, marks).map((piece) => {
              const commentKeys = piece.marks.filter((key) => key !== FOCUS);
              const ending = marks.filter((m) => m.key !== FOCUS && m.end === piece.end && piece.marks.includes(m.key));

              const text = piece.marks.includes(FOCUS) ? (
                <mark data-preview-active-highlight style={{ background: marking.focusColor }} className="rounded-sm">
                  {piece.text}
                </mark>
              ) : (
                piece.text
              );

              if (commentKeys.length === 0) return <span key={piece.start}>{text}</span>;

              return (
                <span
                  key={piece.start}
                  data-anchors={commentKeys.join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    marking.onSelect(commentKeys[0]);
                  }}
                  className="cursor-pointer underline decoration-dotted decoration-[var(--cd-navy)] underline-offset-4"
                >
                  {text}
                  {ending.map((m) => (
                    <sup key={m.key} className="ml-0.5 text-[10px] font-semibold text-[var(--cd-navy)] no-underline">
                      {marking.numbers.get(m.key)}
                    </sup>
                  ))}
                </span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}
