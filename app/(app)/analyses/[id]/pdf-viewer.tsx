"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask, PageViewport } from "pdfjs-dist";
import type { HighlightRect } from "@/lib/locate-text";
import { Button } from "@/components/ui/button";

export interface PdfViewerProps {
  documentUrl: string;
  activePage: number | null; // 1-based, same convention as Finding.location_page
  highlightRects: HighlightRect[] | null; // pageIndex is 0-based; filtered here to the displayed page
  highlightColor: string; // e.g. "var(--severity-high-bg)"
}

export default function PdfViewer({ documentUrl, activePage, highlightRects, highlightColor }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const viewportRef = useRef<PageViewport | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [renderVersion, setRenderVersion] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [firstRenderDone, setFirstRenderDone] = useState(false);
  const [boxes, setBoxes] = useState<{ left: number; top: number; width: number; height: number }[]>([]);

  // Jump to a finding's page when clicked, independent of highlight success.
  // Adjusting state during render (rather than in an effect) when a prop
  // changes avoids an extra commit — React's documented pattern for this.
  const [syncedActivePage, setSyncedActivePage] = useState(activePage);
  if (activePage !== syncedActivePage) {
    setSyncedActivePage(activePage);
    if (activePage != null && activePage >= 1) {
      setCurrentPage(activePage);
      setRenderVersion((v) => v + 1);
    }
  }

  function updateHighlightBoxes() {
    const viewport = viewportRef.current;
    if (!viewport || !highlightRects) {
      setBoxes([]);
      return;
    }
    const pageIndex = currentPage - 1;
    const next = highlightRects
      .filter((r) => r.pageIndex === pageIndex)
      .map((r) => {
        const [vx1, vy1] = viewport.convertToViewportPoint(r.x, r.y);
        const [vx2, vy2] = viewport.convertToViewportPoint(r.x + r.width, r.y + r.height);
        return {
          left: Math.min(vx1, vx2),
          top: Math.min(vy1, vy2),
          width: Math.abs(vx2 - vx1),
          height: Math.abs(vy2 - vy1),
        };
      });
    setBoxes(next);
  }

  // Load the document once per URL.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadError("");
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const bytes = await fetch(documentUrl).then((r) => r.arrayBuffer());
        if (cancelled) return;

        const pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) return;

        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
        setCurrentPage(1);
        setRenderVersion((v) => v + 1);
      } catch {
        if (!cancelled) setLoadError("Could not load the document preview.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [documentUrl]);

  // Rescale on container resize (the iframe reflowed on this automatically; a
  // fixed-scale canvas would not without this).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setRenderVersion((v) => v + 1), 150);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  // Render the current page's bitmap.
  useEffect(() => {
    let cancelled = false;

    async function render() {
      const pdfDoc = pdfDocRef.current;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!pdfDoc || !canvas || !container) return;

      let page: PDFPageProxy;
      try {
        page = await pdfDoc.getPage(currentPage);
      } catch {
        return;
      }
      if (cancelled) return;

      const unscaled = page.getViewport({ scale: 1 });
      const scale = Math.max(container.clientWidth / unscaled.width, 0.1);
      const viewport = page.getViewport({ scale });
      viewportRef.current = viewport;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      renderTaskRef.current?.cancel();
      const task = page.render({ canvas, canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // Cancelled renders reject — expected when a newer render supersedes this one.
        return;
      }
      if (cancelled) return;
      updateHighlightBoxes();
      setFirstRenderDone(true);
    }

    render();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateHighlightBoxes intentionally not tracked; called imperatively after render completes
  }, [currentPage, renderVersion]);

  // Reposition the highlight overlay without repainting the page bitmap.
  useEffect(() => {
    updateHighlightBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateHighlightBoxes intentionally not tracked; called imperatively after render completes
  }, [highlightRects, currentPage]);

  function goToPage(page: number) {
    if (page < 1 || page > numPages) return;
    setCurrentPage(page);
    setRenderVersion((v) => v + 1);
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} className="relative flex-1 overflow-auto bg-[var(--surface-muted)] flex justify-center">
        {loadError ? (
          <p className="p-6 text-sm text-[var(--severity-high)]">{loadError}</p>
        ) : !firstRenderDone ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--cd-navy)]"
              role="status"
              aria-label="Loading document preview"
            />
          </div>
        ) : null}
        {!loadError && (
          <div className="relative h-fit">
            <canvas ref={canvasRef} className="block shadow-sm" />
            {boxes.map((box, i) => (
              <div
                key={i}
                className="absolute pointer-events-none"
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                  background: highlightColor,
                  opacity: 0.85,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-white px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
            ← Prev
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            Page {currentPage} of {numPages || "..."}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= numPages}
          >
            Next →
          </Button>
        </div>
        <Button variant="ghost" size="sm" href={documentUrl} download className="shrink-0">
          Download original
        </Button>
      </div>
    </div>
  );
}
