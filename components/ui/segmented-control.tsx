"use client";

import { cn } from "@/lib/cn";

/**
 * A single choice between a few options, drawn as one full-width control split
 * into equal parts. Same height and text size as the form controls around it.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid h-10 w-full auto-cols-fr grid-flow-col rounded-md border border-[var(--border-strong)] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-[5px] text-sm font-medium transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]",
            value === option.value
              ? "bg-[var(--cd-navy)] text-white"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
