import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * One shared rendering shape for every colored label/badge in the app
 * (job status, provenance, finding action, severity tag) — the color
 * selection logic stays local to each domain's own lookup table; this just
 * unifies the markup so there's one visual recipe instead of several.
 * `style` is for callers whose color comes from a runtime lookup (severity) —
 * Tailwind can't statically generate a class built from an interpolated
 * value, so those pass colors via inline style instead of `className`.
 */
export function StatusPill({
  label,
  className,
  style,
}: {
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span style={style} className={cn("inline-block text-xs font-semibold rounded-md px-3 py-1", className)}>
      {label}
    </span>
  );
}
