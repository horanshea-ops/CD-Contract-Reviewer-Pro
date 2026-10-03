import type { Category, LibrarySeverity } from "./types";

/** A clause name as an admin types it, turned into the snake_case key the library and findings use. */
export function clauseKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const LIBRARY_SEVERITIES = ["high", "medium", "low"] as const satisfies readonly LibrarySeverity[];

export function isLibrarySeverity(value: unknown): value is LibrarySeverity {
  return typeof value === "string" && (LIBRARY_SEVERITIES as readonly string[]).includes(value);
}

export const CATEGORIES = ["business", "legal", "other"] as const satisfies readonly Category[];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
