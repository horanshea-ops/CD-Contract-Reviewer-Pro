"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * The contract and the findings side by side, with a divider the associate
 * can drag to give either more room. From the lg breakpoint only; below it
 * the panes stack.
 *
 * The findings pane's share of the width is a CSS variable, `--findings-width`,
 * which each pane reads in an `lg:` width class. It is remembered in this
 * browser, so every review opens at the associate's last width.
 */

const STORAGE_KEY = "review-findings-width";
const MIN = 30;
const MAX = 80;
const DEFAULT = 50;
const STEP = 5;

const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n)));

function readSaved(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved ? clamp(saved) : null;
  } catch {
    return null;
  }
}

function save(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // A private window can refuse storage; the width still applies until reload.
  }
}

export function ResizableSplit({ contract, findings }: { contract: ReactNode; findings: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The review screen renders this only after loading the review in the browser, so storage is available here.
  const [width, setWidth] = useState(() => readSaved() ?? DEFAULT);
  const [dragging, setDragging] = useState(false);

  function update(next: number) {
    const clamped = clamp(next);
    setWidth(clamped);
    save(clamped);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setWidth(clamp(((rect.right - e.clientX) / rect.width) * 100));
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    document.body.style.userSelect = "";
    save(width);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // The divider moves with the arrow, so ← widens the findings pane.
    if (e.key === "ArrowLeft") update(width + STEP);
    else if (e.key === "ArrowRight") update(width - STEP);
    else if (e.key === "Home") update(DEFAULT);
    else return;
    e.preventDefault();
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 flex flex-col lg:flex-row"
      style={{ "--findings-width": `${width}%` } as CSSProperties}
    >
      {contract}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the findings pane"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={width}
        aria-valuetext={`Findings take ${width}% of the width`}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => update(DEFAULT)}
        onKeyDown={onKeyDown}
        className="group hidden lg:block absolute inset-y-0 z-20 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
        style={{ left: `calc(100% - ${width}%)` }}
      >
        <span
          aria-hidden="true"
          className={`absolute left-1/2 top-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors group-hover:bg-[var(--cd-navy)] group-focus-visible:bg-[var(--cd-navy)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--cd-blue)] ${
            dragging ? "bg-[var(--cd-navy)]" : "bg-[var(--border-strong)]"
          }`}
        />
      </div>
      {findings}
    </div>
  );
}
