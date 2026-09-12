import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

function makeText(defaultClass: string, defaultAs: ElementType) {
  return function Text({ as, className, children, ...rest }: TextProps) {
    const Tag = as ?? defaultAs;
    return (
      <Tag className={cn(defaultClass, className)} {...rest}>
        {children}
      </Tag>
    );
  };
}

/** Dashboard stat numbers only — never a page title, never a card heading. */
export const Display = makeText("text-2xl font-semibold", "p");

/** Page titles. */
export const Title = makeText("text-xl font-semibold", "h1");

/** Card, section, and dialog headings. */
export const Subtitle = makeText("text-base font-semibold", "h2");

/** UI copy, labels, buttons — the default step for anything that isn't a heading, caption, or prose. */
export const Body = makeText("text-sm", "p");

/** Captions, hints, timestamps. */
export const Meta = makeText("text-xs", "p");

/**
 * Prose a person actually reads rather than UI chrome — finding text, quoted
 * contract language, the DOCX preview, email draft bodies. 15px sits between
 * Body and Subtitle because neither reads well at length; relaxed leading is
 * for the same reason.
 */
export const ReadingText = makeText("text-[15px] leading-relaxed", "p");
