"use client";

import { SEVERITY_STYLE } from "./finding-card";
import type { FindingsOverview, FindingSeverity } from "@/lib/findings-overview";
import { formatCurrency } from "@/lib/format";
import { Body, Meta } from "@/components/ui/typography";
import { cn } from "@/lib/cn";

const SEVERITY_KEYS: FindingSeverity[] = ["high", "medium", "low", "note"];

/**
 * Sticky strip above the findings list — severity counts doubling as filter
 * toggles, the undecided count, a hide-decided toggle, and the review's total
 * exposure. Counts always reflect the whole review, not the active filter,
 * so they read as an honest total rather than a live filter readout.
 */
export default function FindingsOverviewBar({
  overview,
  hiddenSeverities,
  onToggleSeverity,
  hideDecided,
  onToggleHideDecided,
}: {
  overview: FindingsOverview;
  hiddenSeverities: Set<FindingSeverity>;
  onToggleSeverity: (severity: FindingSeverity) => void;
  hideDecided: boolean;
  onToggleHideDecided: () => void;
}) {
  const filtersActive = hiddenSeverities.size > 0 || hideDecided;

  function clearFilters() {
    for (const severity of hiddenSeverities) onToggleSeverity(severity);
    if (hideDecided) onToggleHideDecided();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        {SEVERITY_KEYS.map((severity) => {
          const style = SEVERITY_STYLE[severity];
          const hidden = hiddenSeverities.has(severity);
          return (
            <button
              key={severity}
              type="button"
              onClick={() => onToggleSeverity(severity)}
              aria-pressed={!hidden}
              style={hidden ? undefined : { background: style.bg, color: style.textColor }}
              className={cn(
                "text-xs font-semibold rounded-md px-3 py-1 border transition-colors",
                hidden ? "border-[var(--border)] text-[var(--text-muted)] bg-transparent" : "border-transparent"
              )}
            >
              {overview.bySeverity[severity]} {style.label}
            </button>
          );
        })}
      </div>

      {overview.undecidedCount > 0 && (
        <Meta as="span" className="text-[var(--text-muted)]">
          {overview.undecidedCount} still need{overview.undecidedCount === 1 ? "s" : ""} a decision
        </Meta>
      )}

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
        <input type="checkbox" checked={hideDecided} onChange={onToggleHideDecided} />
        Hide decided
      </label>

      <Body as="span" className="font-medium text-[var(--text-primary)] ml-auto">
        {formatCurrency(overview.totalExposure)}
        <Meta as="span" className="font-normal text-[var(--text-secondary)] ml-1.5">
          exposure on the table
        </Meta>
      </Body>

      {filtersActive && (
        <button type="button" onClick={clearFilters} className="text-xs text-[var(--cd-navy)] hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}
