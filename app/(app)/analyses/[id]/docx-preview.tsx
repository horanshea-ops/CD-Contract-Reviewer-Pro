"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  rangeOrNearestWord,
  resolveHighlight,
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
}

const commentKey = (id: string) => `comment-${id}`;

function commentDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export interface DocxPreviewProps {
  analysisId: string;
  hadExistingRevisions: boolean;
  existingRevisionAuthors: string[];
  existingRevisionCount: number;
  selectedFinding: { id: string; quoted_text: string | null } | null;
  highlightColor: string;
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
}: DocxPreviewProps) {
  const [parts, setParts] = useState<PreviewPart[] | null>(null);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [commentsTotal, setCommentsTotal] = useState(0);
  const [showComments, setShowComments] = useState(false);
  // The comment last clicked, and the finding selected at the time. Selecting another finding takes the focus back.
  const [commentFocus, setCommentFocus] = useState<{ id: string; findingId: string | null } | null>(null);
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

  const focus = useMemo(() => {
    const comment =
      showComments && commentFocus && commentFocus.findingId === selectedFindingId
        ? comments.find((c) => c.id === commentFocus.id)
        : undefined;
    if (comment && parts) {
      const text = parts.find((p) => p.part === comment.part)?.text ?? "";
      return { part: comment.part, ...rangeOrNearestWord(text, comment.start, comment.end), color: COMMENT_FOCUS_COLOR };
    }
    return match ? { part: match.part, start: match.start, end: match.end, color: highlightColor } : null;
  }, [showComments, commentFocus, selectedFindingId, comments, parts, match, highlightColor]);

  const marking = useMemo<Marking>(() => {
    const marks = new Map<string, PreviewMark[]>();
    const numbers = new Map<string, number>();
    const add = (part: string, mark: PreviewMark) => marks.set(part, [...(marks.get(part) ?? []), mark]);

    if (focus) add(focus.part, { key: FOCUS, start: focus.start, end: focus.end });
    if (showComments) {
      comments.forEach((c, i) => {
        numbers.set(commentKey(c.id), i + 1);
        if (c.end > c.start) add(c.part, { key: commentKey(c.id), start: c.start, end: c.end });
      });
    }
    return { marks, numbers, focusColor: focus?.color ?? highlightColor };
  }, [focus, showComments, comments, highlightColor]);

  useEffect(() => {
    if (!focus) return;
    containerRef.current
      ?.querySelector("[data-preview-active-highlight]")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

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
      {(hadExistingRevisions || comments.length > 0) && (
        <div className="flex items-center justify-between gap-3 bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] px-4 py-2 shrink-0">
          <Meta as="span">
            {hadExistingRevisions &&
              `${existingRevisionCount} tracked change${existingRevisionCount === 1 ? "" : "s"} already in this file, by ${existingRevisionAuthors.join(", ")}`}
          </Meta>
          {comments.length > 0 && (
            <Button
              size="sm"
              variant={showComments ? "primary" : "secondary"}
              aria-pressed={showComments}
              onClick={() => setShowComments((on) => !on)}
              className="shrink-0 bg-white"
            >
              Comments ({commentsTotal})
            </Button>
          )}
        </div>
      )}
      {showComments && (
        <ol
          aria-label="Comments already in this file"
          className="shrink-0 max-h-[38%] overflow-auto border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2"
        >
          {comments.map((c, i) => (
            <li key={c.id} className={c.replyTo ? "ml-6" : undefined}>
              <button
                type="button"
                onClick={() => setCommentFocus({ id: c.id, findingId: selectedFindingId })}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
              >
                <Meta as="span" className="block text-[var(--text-muted)]">
                  {i + 1} · {c.author || "Unnamed"}
                  {commentDate(c.date) && ` · ${commentDate(c.date)}`}
                  {c.replyTo && " · reply"}
                  {c.resolved && " · resolved"}
                </Meta>
                <Body as="span" className="block whitespace-pre-wrap">
                  {c.text}
                </Body>
                {(c.context || c.quoted) && (
                  <Meta as="span" className="block truncate text-[var(--text-muted)]">
                    on “{c.context || c.quoted}”
                  </Meta>
                )}
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
      <div ref={containerRef} className="flex-1 overflow-auto bg-white px-6 py-4">
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
    </div>
  );
}

function Block({ block, partName, marking }: { block: PreviewBlock; partName: string; marking: Marking }) {
  if (block.kind === "table") {
    return (
      <table className="border-collapse w-full my-3">
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

        const range = run.range;
        if (!range || !marks.some((m) => m.start < range.end && m.end > range.start)) {
          return (
            <span key={i} className={revisionClass} title={title}>
              {run.text}
            </span>
          );
        }

        // Each piece is covered by a fixed set of marks: the focus highlight, comment anchors, or both.
        return (
          <span key={i} className={revisionClass} title={title}>
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

              return (
                <span
                  key={piece.start}
                  className={
                    commentKeys.length ? "underline decoration-dotted decoration-[var(--cd-navy)] underline-offset-4" : undefined
                  }
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
