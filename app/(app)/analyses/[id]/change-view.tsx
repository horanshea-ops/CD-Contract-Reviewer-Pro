"use client";

import { useState } from "react";
import { changeSegments, fold } from "@/lib/change-segments";
import { Body, Meta } from "@/components/ui/typography";
import { cn } from "@/lib/cn";

/**
 * A finding's change, marked up word by word, with long unchanged stretches
 * folded until the associate asks for the full wording.
 */

/** Characters past which an addition opens folded. */
const LONG_ADDITION_CHARS = 320;

function ToggleFull({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="text-xs text-[var(--cd-navy)] hover:underline mt-1">
      {open ? "Show less" : "Show full wording"}
    </button>
  );
}

const LABEL_CLASSES = "font-semibold uppercase tracking-wide mb-1";

export default function ChangeView({
  quote,
  language,
  addition,
  footnote,
}: {
  quote: string | null;
  language: string;
  /** True for a clause the contract doesn't have, which has nothing to mark against. */
  addition: boolean;
  footnote?: React.ReactNode;
}) {
  const [full, setFull] = useState(false);

  if (addition || !quote) {
    const long = language.length > LONG_ADDITION_CHARS;
    return (
      <div className="mt-3 rounded-md border border-[var(--border)] px-3 py-2.5 border-l-[3px] border-l-[var(--cd-navy)]">
        <Meta as="p" className={cn(LABEL_CLASSES, "text-[var(--cd-navy)]")}>
          Proposed addition
        </Meta>
        <Body as="p" className={cn("text-[var(--text-primary)]", long && !full && "line-clamp-3")}>
          {language}
        </Body>
        {long && <ToggleFull open={full} onClick={() => setFull((v) => !v)} />}
        {footnote}
      </div>
    );
  }

  const segments = changeSegments(quote, language);
  const foldedSegments = segments.map((s, i) =>
    s.kind === "same" ? { ...s, text: fold(s.text, i === 0, i === segments.length - 1) } : s
  );
  const folded = foldedSegments.some((s, i) => s.text !== segments[i].text);
  const shown = full ? segments : foldedSegments;

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] px-3 py-2.5 border-l-[3px] border-l-[var(--cd-navy)]">
      <Meta as="p" className={cn(LABEL_CLASSES, "text-[var(--cd-navy)]")}>
        Change
      </Meta>
      <Body as="p" className="text-[var(--text-secondary)]">
        {shown.map((s, i) =>
          s.kind === "same" ? (
            <span key={i}>{s.text}</span>
          ) : (
            // Spaces sit outside the mark so they aren't struck or underlined. HTML collapses any doubles.
            <span key={i}>
              {" "}
              {s.kind === "del" ? (
                <del className="text-[var(--severity-high)]">{s.text}</del>
              ) : (
                <ins className="text-[var(--cd-navy)] underline underline-offset-2 bg-[var(--cd-blue-pale)]">{s.text}</ins>
              )}{" "}
            </span>
          )
        )}
      </Body>
      {(folded || full) && <ToggleFull open={full} onClick={() => setFull((v) => !v)} />}
      {footnote}
    </div>
  );
}
