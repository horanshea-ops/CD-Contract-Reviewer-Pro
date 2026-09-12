"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveHighlight, type PreviewBlock, type PreviewPart, type PreviewRun } from "@/lib/docx-preview";
import { Body, Meta, ReadingText, Subtitle, Title } from "@/components/ui/typography";
import { titleCase } from "@/lib/format";

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

  useEffect(() => {
    if (!match) return;
    containerRef.current
      ?.querySelector("[data-preview-active-highlight]")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [match]);

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
      {hadExistingRevisions && (
        <Meta as="div" className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] px-4 py-2 shrink-0">
          Round 2+, {existingRevisionCount} prior edit{existingRevisionCount === 1 ? "" : "s"} by{" "}
          {existingRevisionAuthors.join(", ")}
        </Meta>
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
              <Block key={i} block={block} partName={part.part} match={match} highlightColor={highlightColor} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Block({
  block,
  partName,
  match,
  highlightColor,
}: {
  block: PreviewBlock;
  partName: string;
  match: ReturnType<typeof resolveHighlight>;
  highlightColor: string;
}) {
  if (block.kind === "table") {
    return (
      <table className="border-collapse w-full my-3">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.cells.map((cell, c) => (
                <td key={c} className="border border-[var(--border)] p-1.5 align-top">
                  {cell.blocks.map((b, i) => (
                    <Block key={i} block={b} partName={partName} match={match} highlightColor={highlightColor} />
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  const runs = <Runs runs={block.runs} partName={partName} match={match} highlightColor={highlightColor} />;

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

function Runs({
  runs,
  partName,
  match,
  highlightColor,
}: {
  runs: PreviewRun[];
  partName: string;
  match: ReturnType<typeof resolveHighlight>;
  highlightColor: string;
}) {
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

        const overlapsMatch =
          match && match.part === partName && run.range && run.range.start < match.end && run.range.end > match.start;

        if (!overlapsMatch || !run.range) {
          return (
            <span key={i} className={revisionClass} title={title}>
              {run.text}
            </span>
          );
        }

        // Split the run into before/overlap/after against the run's own text,
        // using offsets relative to run.range.start (character-for-character,
        // since run.text is exactly run.range.end - run.range.start long).
        const overlapStart = Math.max(0, match!.start - run.range.start);
        const overlapEnd = Math.min(run.text.length, match!.end - run.range.start);
        const before = run.text.slice(0, overlapStart);
        const overlap = run.text.slice(overlapStart, overlapEnd);
        const after = run.text.slice(overlapEnd);

        return (
          <span key={i} className={revisionClass} title={title}>
            {before}
            <mark data-preview-active-highlight style={{ background: highlightColor }} className="rounded-sm">
              {overlap}
            </mark>
            {after}
          </span>
        );
      })}
    </>
  );
}
