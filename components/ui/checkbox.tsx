import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * Styled native checkbox — accent color plus the app's focus ring, so every
 * checkbox shares one visual recipe instead of the browser default.
 */
export function Checkbox({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--cd-navy)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]",
        className
      )}
      {...rest}
    />
  );
}
