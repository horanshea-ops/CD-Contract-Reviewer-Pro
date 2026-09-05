"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Gradient background instead of the flat primary color — reserved for
   * the one hero-CTA use case (e.g. the dashboard's primary action), not a
   * general-purpose variant. Only meaningful with the default primary look. */
  gradient?: boolean;
  loading?: boolean;
  loadingText?: string;
  href?: string;
  download?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-[var(--cd-navy)] text-white hover:bg-[var(--cd-navy-dark)]",
  secondary: "border border-[var(--border-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)]",
  ghost: "text-[var(--text-secondary)] hover:text-[var(--cd-navy)] hover:bg-[var(--surface-muted)]",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-4 py-2",
};

/**
 * Single source of truth for every button-shaped control in the app —
 * replaces four ad hoc padding/opacity/transition recipes that had drifted
 * across screens with no shared component. `href` renders a next/link
 * (covers the export/download links styled as buttons); otherwise a real
 * `<button>`. `loading` disables the control and swaps in `loadingText`
 * rather than each screen hand-rolling its own "...ing" label swap.
 */
export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  gradient,
  loading,
  loadingText,
  href,
  download,
  disabled,
  className,
  style,
  children,
  ...rest
}: ButtonProps) {
  const classes = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
    "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]",
    gradient ? "text-white hover:brightness-110" : VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && "w-full",
    className
  );
  const mergedStyle = gradient
    ? { background: "linear-gradient(135deg, var(--cd-navy), var(--cd-navy-darker))", ...style }
    : style;

  const content = loading ? (loadingText ?? "Loading...") : children;

  if (href) {
    return (
      <Link href={href} download={download} className={classes} style={mergedStyle}>
        {content}
      </Link>
    );
  }

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes}
      style={mergedStyle}
    >
      {content}
    </button>
  );
}
