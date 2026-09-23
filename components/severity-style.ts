import type { FindingSeverity } from "@/lib/findings-overview";

/** How each severity is drawn, wherever a severity appears. */
export const SEVERITY_STYLE: Record<
  FindingSeverity,
  { label: string; borderColor: string; borderWidth: string; textColor: string; bg: string }
> = {
  high: {
    label: "HIGH",
    borderColor: "var(--severity-high)",
    borderWidth: "3px",
    textColor: "var(--severity-high)",
    bg: "var(--severity-high-bg)",
  },
  medium: {
    label: "MEDIUM",
    borderColor: "var(--severity-medium)",
    borderWidth: "3px",
    textColor: "var(--severity-medium)",
    bg: "var(--severity-medium-bg)",
  },
  low: {
    label: "LOW",
    borderColor: "var(--severity-low)",
    borderWidth: "2px",
    textColor: "var(--severity-low)",
    bg: "var(--severity-low-bg)",
  },
  note: {
    label: "NOTE",
    borderColor: "var(--severity-note)",
    borderWidth: "2px",
    textColor: "var(--severity-note)",
    bg: "var(--severity-note-bg)",
  },
};
