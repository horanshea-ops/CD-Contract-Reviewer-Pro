import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardPadding = "none" | "sm" | "md" | "lg";

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: "",
  sm: "px-4 py-3",
  md: "p-4",
  lg: "p-6",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  /** Shadow instead of a border, for hero/stat surfaces — deliberately not
   * used on list/table contexts (findings list, standards cards), which stay
   * flat-bordered so a dense page doesn't look busy. */
  elevated?: boolean;
}

export function Card({ padding = "md", elevated, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg bg-white",
        elevated ? "shadow-[var(--shadow-sm)]" : "border border-[var(--border)]",
        PADDING_CLASSES[padding],
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
