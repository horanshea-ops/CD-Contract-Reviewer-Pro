import type { Category } from "@/lib/standards/types";

export const CATEGORY_KEYS: Category[] = ["business", "legal", "other"];

/** How each finding category is drawn, wherever a category appears. */
export const CATEGORY_STYLE: Record<Category, { label: string; name: string; textColor: string; bg: string }> = {
  business: { label: "BUSINESS", name: "Business", textColor: "var(--cd-navy)", bg: "var(--cd-blue-pale)" },
  legal: { label: "LEGAL", name: "Legal", textColor: "var(--category-legal)", bg: "var(--category-legal-bg)" },
  other: { label: "OTHER", name: "Other", textColor: "var(--severity-note)", bg: "var(--severity-note-bg)" },
};
