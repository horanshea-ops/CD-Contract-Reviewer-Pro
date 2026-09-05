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
}

export function Card({ padding = "md", className, children, ...rest }: CardProps) {
  return (
    <div className={cn("rounded-md border border-[var(--border)] bg-white", PADDING_CLASSES[padding], className)} {...rest}>
      {children}
    </div>
  );
}
