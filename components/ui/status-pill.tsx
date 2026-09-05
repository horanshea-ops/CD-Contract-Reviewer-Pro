import { cn } from "@/lib/cn";

/**
 * One shared rendering shape for every colored label/badge in the app
 * (job status, provenance, finding action, severity tag) — the color
 * selection logic stays local to each domain's own lookup table; this just
 * unifies the markup so there's one visual recipe instead of several.
 */
export function StatusPill({ label, className }: { label: string; className: string }) {
  return <span className={cn("inline-block text-xs font-medium rounded px-2 py-0.5", className)}>{label}</span>;
}
