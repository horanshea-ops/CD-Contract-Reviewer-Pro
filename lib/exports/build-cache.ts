import { createHash } from "node:crypto";

/**
 * Holds an expensive export build between the preflight check and the download
 * that follows it.
 *
 * The dialog asks each format for a verdict before it asks for the file, so the
 * redline engine and the clean-contract build otherwise run twice for one click.
 * Caching the first run roughly halves the wait on a multi-format export.
 *
 * Every entry is keyed by a fingerprint of the exact inputs that produced it. A
 * decision changed between the two requests changes the fingerprint and forces a
 * rebuild, so a cache hit is only ever the same bytes the same inputs would
 * produce now. These documents reach a hotel, and serving a stale one would be
 * worse than the wait this saves.
 *
 * Process-local and short-lived. A miss costs only the rebuild that would have
 * happened anyway, so nothing depends on the entry surviving.
 */

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 8;

interface CacheEntry {
  fingerprint: string;
  value: unknown;
  expires: number;
}

const entries = new Map<string, CacheEntry>();

/** Stable hash of whatever a build actually reads. Order matters, so callers pass arrays as-is. */
export function fingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export async function cachedBuild<T>(
  key: string,
  inputFingerprint: string,
  build: () => Promise<T>
): Promise<T> {
  evictExpired();

  const hit = entries.get(key);
  if (hit && hit.fingerprint === inputFingerprint) {
    return hit.value as T;
  }

  const value = await build();

  entries.set(key, { fingerprint: inputFingerprint, value, expires: Date.now() + TTL_MS });
  evictOldest();
  return value;
}

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expires <= now) entries.delete(key);
  }
}

/** Map iterates in insertion order, so the first key is the oldest write. */
function evictOldest() {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
  }
}

/** Tests only. */
export function clearBuildCache() {
  entries.clear();
}
