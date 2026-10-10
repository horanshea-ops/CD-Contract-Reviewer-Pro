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
  pressed,
}: {
  keys: K[];
  styleOf: (key: K) => { label: string; textColor: string; bg: string };
  counts: Record<K, number>;
  hidden: Set<K>;
  onToggle: (key: K) => void;
  /** Which button reads as pressed. A button is pressed while its key shows, unless this says otherwise. */
  pressed?: (key: K) => boolean;
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
            aria-pressed={pressed ? pressed(key) : !off}
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

/**
 * One button per kind of finding. Pushing one shows that kind alone, and
 * pushing it again shows every kind.
 */
export function CategoryToggles({
  counts,
  only,
  onPick,
}: {
  counts: Record<Category, number>;
  only: Category | null;
  onPick: (category: Category) => void;
}) {
  const dimmed = new Set(only ? CATEGORY_KEYS.filter((k) => k !== only) : []);
  return (
    <Toggles
      keys={CATEGORY_KEYS}
      styleOf={(k) => CATEGORY_STYLE[k]}
      counts={counts}
      hidden={dimmed}
      onToggle={onPick}
      pressed={(k) => k === only}
    />
  );
}
