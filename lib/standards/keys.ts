/** A clause name as an admin types it, turned into the snake_case key the library and findings use. */
export function clauseKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const SEVERITIES = ["high", "medium", "low", "note"] as const;

export function isSeverity(value: unknown): value is (typeof SEVERITIES)[number] {
  return typeof value === "string" && (SEVERITIES as readonly string[]).includes(value);
}
