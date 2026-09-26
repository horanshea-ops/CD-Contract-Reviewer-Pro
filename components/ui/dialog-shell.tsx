"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Subtitle } from "@/components/ui/typography";

type DialogMaxWidth = "sm" | "md" | "lg" | "xl" | "2xl";

const MAX_WIDTH_CLASSES: Record<DialogMaxWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
};

interface DialogShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: DialogMaxWidth;
  /** Caps the panel at 85% viewport height and scrolls its body — for dialogs whose content can run long (the email drafts). */
  scrollBody?: boolean;
  /** False while closing would interrupt work, such as a download in progress. */
  dismissible?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * One overlay/panel/header shape for every modal in the app: the export
 * picker, the email picker and the two email draft panels. The X here is the
 * one close affordance every dialog shares; callers supply their own footer
 * actions (Cancel, Export selected, ...).
 *
 * Opening moves keyboard focus into the panel and closing returns it to where
 * it was. Escape closes, like the X.
 */
export function DialogShell({
  open,
  onClose,
  title,
  maxWidth = "lg",
  scrollBody,
  dismissible = true,
  footer,
  children,
}: DialogShellProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  useEffect(() => {
    closeRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  useEffect(() => {
    if (!open) return;
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissibleRef.current) {
        e.stopPropagation();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "w-full rounded-lg bg-white p-5 shadow-lg outline-none",
          MAX_WIDTH_CLASSES[maxWidth],
          scrollBody && "max-h-[85vh] overflow-y-auto"
        )}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <Subtitle id={titleId} className="text-[var(--text-primary)]">
            {title}
          </Subtitle>
          <button
            type="button"
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {children}

        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
