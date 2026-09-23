"use client";

import { SEVERITY_STYLE } from "@/components/severity-style";
import type { FindingSeverity } from "@/lib/findings-overview";
import { cn } from "@/lib/cn";

const SEVERITY_KEYS: FindingSeverity[] = ["high", "medium", "low", "note"];

/**
 * One button per severity, showing its count and toggling it on or off. The
 * counts are always the full totals, not what the active filter leaves.
 */
export function SeverityToggles({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<FindingSeverity, number>;
  hidden: Set<FindingSeverity>;
  onToggle: (severity: FindingSeverity) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {SEVERITY_KEYS.map((severity) => {
        const style = SEVERITY_STYLE[severity];
        const off = hidden.has(severity);
        return (
          <button
            key={severity}
            type="button"
            onClick={() => onToggle(severity)}
            aria-pressed={!off}
            style={off ? undefined : { background: style.bg, color: style.textColor }}
            className={cn(
              "text-xs font-semibold rounded-md px-3 py-1 border transition-colors",
              off ? "border-[var(--border)] text-[var(--text-muted)] bg-transparent" : "border-transparent"
            )}
          >
            {counts[severity]} {style.label}
          </button>
        );
      })}
    </div>
  );
}
