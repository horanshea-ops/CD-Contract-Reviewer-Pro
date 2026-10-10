"use client";

import type { FindingsOverview } from "@/lib/findings-overview";
import type { Category } from "@/lib/standards/types";
import { formatCurrency } from "@/lib/format";
import { Body, Meta } from "@/components/ui/typography";
import { Checkbox } from "@/components/ui/checkbox";
import { CategoryToggles } from "@/components/severity-toggles";

/**
 * Sticky strip above the findings list — category counts that each filter the
 * list to that kind, the undecided count, a hide-decided toggle, and the review's total
 * exposure when any finding has a figure. Counts always reflect the whole
 * review, not the active filter, so they read as an honest total rather than
 * a live filter readout.
 */
export default function FindingsOverviewBar({
  overview,
  onlyCategory,
  onPickCategory,
  hideDecided,
  onToggleHideDecided,
}: {
  overview: FindingsOverview;
  /** The one kind of finding shown, or null for every kind. */
  onlyCategory: Category | null;
  onPickCategory: (category: Category) => void;
  hideDecided: boolean;
  onToggleHideDecided: () => void;
}) {
  const filtersActive = onlyCategory !== null || hideDecided;

  function clearFilters() {
    if (onlyCategory) onPickCategory(onlyCategory);
    if (hideDecided) onToggleHideDecided();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <CategoryToggles counts={overview.byCategory} only={onlyCategory} onPick={onPickCategory} />

      {overview.undecidedCount > 0 && (
        <Meta as="span" className="text-[var(--text-muted)]">
          {overview.undecidedCount} still need{overview.undecidedCount === 1 ? "s" : ""} a decision
        </Meta>
      )}

      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
        <Checkbox checked={hideDecided} onChange={onToggleHideDecided} />
        Hide decided
      </label>

      {overview.hasExposure && (
        <Body as="span" className="font-medium text-[var(--text-primary)] ml-auto">
          {formatCurrency(overview.totalExposure, overview.exposureCurrency)}
          <Meta as="span" className="font-normal text-[var(--text-secondary)] ml-1.5">
            exposure on the table
          </Meta>
        </Body>
      )}

      {filtersActive && (
        <button type="button" onClick={clearFilters} className="text-xs text-[var(--cd-navy)] hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );
}
