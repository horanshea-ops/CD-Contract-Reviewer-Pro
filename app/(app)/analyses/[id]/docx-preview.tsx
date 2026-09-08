"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveHighlight, type PreviewBlock, type PreviewPart, type PreviewRun } from "@/lib/docx-preview";

export interface DocxPreviewProps {
  analysisId: string;
  hadExistingRevisions: boolean;
  existingRevisionAuthors: string[];
  existingRevisionCount: number;
  selectedFinding: { id: string; quoted_text: string | null } | null;
  highlightColor: string;
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-lg font-semibold mt-4 mb-2",
  2: "text-base font-semibold mt-4 mb-2",
  3: "text-sm font-semibold mt-3 mb-1.5",
  4: "text-sm font-semibold mt-3 mb-1.5",
  5: "text-sm font-medium mt-2 mb-1",
  6: "text-sm font-medium mt-2 mb-1",
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
        <p className="text-sm text-[var(--severity-high)]">{loadError}</p>
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
        <div className="bg-[var(--cd-blue-pale)] text-[var(--cd-navy)] text-xs px-4 py-2 shrink-0">
          Round 2+ — {existingRevisionCount} prior edit{existingRevisionCount === 1 ? "" : "s"} by:{" "}
          {existingRevisionAuthors.join(", ")}
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-auto bg-white px-6 py-4">
        {parts.map((part) => (
          <div key={part.part}>
            {part.part !== "document" && (
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mt-6 mb-2">
                {part.part}
              </p>
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
      <table className="border-collapse w-full my-3 text-sm">
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
    const className = HEADING_CLASS[block.level] ?? HEADING_CLASS[6];
    switch (block.level) {
      case 1:
        return <h1 className={className}>{runs}</h1>;
      case 2:
        return <h2 className={className}>{runs}</h2>;
      case 3:
        return <h3 className={className}>{runs}</h3>;
      case 4:
        return <h4 className={className}>{runs}</h4>;
      case 5:
        return <h5 className={className}>{runs}</h5>;
      default:
        return <h6 className={className}>{runs}</h6>;
    }
  }

  if (block.kind === "list-item") {
    return (
      <div className="flex gap-2 text-sm mb-1" style={{ marginLeft: block.indent * 16 }}>
        <span className="text-[var(--text-secondary)] shrink-0">{block.marker}</span>
        <span className="whitespace-pre-wrap">{runs}</span>
      </div>
    );
  }

  return <p className="text-sm whitespace-pre-wrap mb-2">{runs}</p>;
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
