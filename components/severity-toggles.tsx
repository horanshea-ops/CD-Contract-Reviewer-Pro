"use client";

import { SEVERITY_STYLE } from "@/components/severity-style";
import { CATEGORY_KEYS, CATEGORY_STYLE } from "@/components/category-style";
import type { FindingSeverity } from "@/lib/findings-overview";
import type { Category } from "@/lib/standards/types";
import { cn } from "@/lib/cn";

const SEVERITY_KEYS: FindingSeverity[] = ["high", "medium", "low", "note"];

/**
 * One button per key, showing its count and toggling it on or off. The counts
 * are always the full totals, not what the active filter leaves.
 */
function Toggles<K extends string>({
  keys,
  styleOf,
  counts,
  hidden,
  onToggle,
}: {
  keys: K[];
  styleOf: (key: K) => { label: string; textColor: string; bg: string };
  counts: Record<K, number>;
  hidden: Set<K>;
  onToggle: (key: K) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {keys.map((key) => {
        const style = styleOf(key);
        const off = hidden.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={!off}
            style={off ? undefined : { background: style.bg, color: style.textColor }}
            className={cn(
              "text-xs font-semibold rounded-md px-3 py-1 border transition-colors",
              off ? "border-[var(--border)] text-[var(--text-muted)] bg-transparent" : "border-transparent"
            )}
          >
            {counts[key]} {style.label}
          </button>
        );
      })}
    </div>
  );
}

export function SeverityToggles<K extends FindingSeverity>({
  keys = SEVERITY_KEYS as K[],
  counts,
  hidden,
  onToggle,
}: {
  keys?: K[];
  counts: Record<K, number>;
  hidden: Set<K>;
  onToggle: (severity: K) => void;
}) {
  return <Toggles keys={keys} styleOf={(k) => SEVERITY_STYLE[k]} counts={counts} hidden={hidden} onToggle={onToggle} />;
}

export function CategoryToggles({
  counts,
  hidden,
  onToggle,
}: {
  counts: Record<Category, number>;
  hidden: Set<Category>;
  onToggle: (category: Category) => void;
}) {
  return (
    <Toggles keys={CATEGORY_KEYS} styleOf={(k) => CATEGORY_STYLE[k]} counts={counts} hidden={hidden} onToggle={onToggle} />
  );
}
