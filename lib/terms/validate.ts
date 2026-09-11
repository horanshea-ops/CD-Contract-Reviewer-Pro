import { parseQuantities } from "../quantities";
import { locateQuote, type LocatablePart } from "../redline-engine/locate";
import { catalogIndex } from "./catalog";
import type {
  Confidence,
  ExtractedTerms,
  RejectedEntry,
  ScheduleTier,
  StatedTerm,
  TermCatalog,
  TermDefinition,
  TermValue,
  Verification,
} from "./types";

/**
 * Checking what the extraction model returned (MASTER_PLAN.md §2.0.2).
 *
 * Three steps, all deterministic and free:
 *
 *  1. Normalise each value to its catalog type. Percentages arrive as written
 *     (90) and are stored as fractions (0.9). A value that cannot be made to
 *     fit its type is rejected with a reason, never stored.
 *  2. Verify it against the document. The quote must be in the contract, and a
 *     figure must appear in its own quote. This is what catches a model that
 *     reads 90% and writes 85.
 *  3. Group repeats. The same value twice is stored once; different values for
 *     one key are all kept and the key is reported as a conflict, because a
 *     contract that says 30 days in the body and 21 in the footer is a fact the
 *     associate needs, not noise to resolve.
 *
 * What verification cannot catch is a quote holding two figures of the same
 * unit — a named-storm clause with a 72-hour trigger and a 24-hour notice
 * window — where the model picks the wrong one. The answer key measures that.
 */

const CONFIDENCES: readonly Confidence[] = ["high", "medium", "low"];

/** Better first, so a repeated value keeps its best-verified occurrence. */
const VERIFICATION_RANK: Record<Verification, number> = { verified: 0, located: 1, contradicted: 2, unlocated: 3 };

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

type Normalized = { ok: true; value: TermValue } | { ok: false; reason: string };

/** A number, or a plain numeric string such as "$289.00" or "90%". */
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^\$\s*/, "").replace(/\s*%$/, "").replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const isIsoDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function normalizePct(raw: unknown, what: string): { ok: true; value: number } | { ok: false; reason: string } {
  const n = toNumber(raw);
  if (n === null) return { ok: false, reason: `${what} is not a number.` };
  if (n < 0 || n > 100) return { ok: false, reason: `${what} of ${n}% is outside 0–100.` };
  // Rounded so 99.9% stores as 0.999, not 0.9990000000000001.
  return { ok: true, value: Number((n / 100).toFixed(10)) };
}

export function normalizeValue(def: TermDefinition, raw: unknown): Normalized {
  switch (def.kind) {
    case "number": {
      if (def.unit === "pct") return normalizePct(raw, "Percentage");
      const n = toNumber(raw);
      if (n === null) return { ok: false, reason: "Not a number." };
      if (n < 0) return { ok: false, reason: `Negative ${def.unit} value ${n}.` };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, reason: "Not true or false." };
    }
    case "enum": {
      if (typeof raw !== "string") return { ok: false, reason: "Not a string." };
      const value = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (value === "other" || value in (def.options ?? {})) return { ok: true, value };
      return { ok: false, reason: `"${raw}" is not one of: ${Object.keys(def.options ?? {}).join(", ")}, other.` };
    }
    case "date": {
      if (typeof raw !== "string" || !isIsoDate(raw.trim())) return { ok: false, reason: `"${String(raw)}" is not a YYYY-MM-DD date.` };
      return { ok: true, value: raw.trim() };
    }
    case "schedule": {
      if (!Array.isArray(raw) || raw.length === 0) return { ok: false, reason: "A schedule must be a non-empty list of tiers." };
      const tiers: ScheduleTier[] = [];
      for (const [i, tier] of raw.entries()) {
        const t = tier as Record<string, unknown>;
        const min = toNumber(t?.days_prior_min);
        const max = t?.days_prior_max === null ? null : toNumber(t?.days_prior_max);
        const pct = normalizePct(t?.pct, `Tier ${i + 1} percentage`);
        if (typeof t?.label !== "string") return { ok: false, reason: `Tier ${i + 1} has no label.` };
        if (min === null || min < 0) return { ok: false, reason: `Tier ${i + 1} has no valid days_prior_min.` };
        if (t?.days_prior_max !== null && (max === null || max < min)) {
          return { ok: false, reason: `Tier ${i + 1} has an invalid days_prior_max.` };
        }
        if (!pct.ok) return pct;
        tiers.push({ label: t.label, days_prior_min: min, days_prior_max: max, pct: pct.value });
      }
      return { ok: true, value: tiers };
    }
  }
}

const quoteFound = (parts: LocatablePart[], quote: string, section: string | null) => {
  // Several matches still prove the wording is in the contract, which is all
  // verification asks. Which occurrence is meant matters for a redline, not here.
  const result = locateQuote(parts, quote, section);
  return result.resolution !== "unresolved" || result.ambiguous === true;
};

const sameNumber = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/**
 * Every bare integer in the text. A comma is a thousands separator only when a
 * digit follows it, so "1,000,000" reads as one number and "16, 2027" as two.
 */
const bareIntegers = (text: string) =>
  [...text.matchAll(/(?<![\d.]|\d,)\d+(?:,\d{3})*(?!\d|,\d)/g)].map((m) => Number(m[0].replace(/,/g, "")));

/** Whether a quote bears out its figure. Words-only figures and zero meanings have nothing to check. */
function numberEvidence(def: TermDefinition, value: number, quote: string): Verification {
  const quantities = parseQuantities(quote).filter((q) => q.unit === def.unit);
  if (quantities.length > 0) {
    return quantities.some((q) => sameNumber(q.value, value)) ? "verified" : "contradicted";
  }
  // Rooms and bare counts carry no unit word to parse, so read the digits.
  const integers = bareIntegers(quote);
  if (def.unit === "rooms" && integers.length > 0) {
    return integers.some((n) => sameNumber(n, value)) ? "verified" : "contradicted";
  }
  return "located";
}

function dateEvidence(iso: string, quote: string): Verification {
  const [year, month, day] = iso.split("-").map(Number);
  const lower = quote.toLowerCase();
  const monthNamed = lower.includes(MONTHS[month - 1]) || new RegExp(`\\b${MONTHS[month - 1].slice(0, 3)}\\.?\\b`).test(lower);
  const numericDate = new RegExp(`\\b0?${month}/0?${day}/(${year}|${String(year).slice(2)})\\b`).test(quote);
  const hasDay = bareIntegers(quote).includes(day);
  return numericDate || (monthNamed && hasDay && quote.includes(String(year))) ? "verified" : "located";
}

export function verify(def: TermDefinition, value: TermValue, quote: string, section: string | null, parts: LocatablePart[]): Verification {
  if (!quoteFound(parts, quote, section)) return "unlocated";
  if (def.kind === "number") return numberEvidence(def, value as number, quote);
  if (def.kind === "date") return dateEvidence(value as string, quote);
  return "located";
}

const canonical = (value: TermValue) =>
  JSON.stringify(value, (_k, v) => (typeof v === "number" ? Math.round(v * 1e9) / 1e9 : v));

/**
 * Turns the model's raw entries into terms ready to store.
 *
 * Keys the model left out are recorded as not stated. A key whose every entry
 * was rejected is neither: the model said something, it could not be read, and
 * the rejection is the record of that.
 */
export function validateTerms(raw: unknown[], catalog: TermCatalog, parts: LocatablePart[]): ExtractedTerms {
  const index = catalogIndex(catalog);
  const rejected: RejectedEntry[] = [];
  const accepted: StatedTerm[] = [];

  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const key = typeof e.term_key === "string" ? e.term_key.trim() : "";
    const def = index.get(key);
    const reject = (reason: string) => rejected.push({ term_key: key, reason, raw: entry });

    if (!def) {
      reject(key ? `"${key}" is not in catalog ${catalog.version}.` : "The entry has no term_key.");
      continue;
    }
    const quote = typeof e.quoted_text === "string" ? e.quoted_text.trim() : "";
    if (!quote) {
      reject("The entry quotes no wording, so nothing ties the value to the contract.");
      continue;
    }
    const normalized = normalizeValue(def, e.value);
    if (!normalized.ok) {
      reject(normalized.reason);
      continue;
    }

    const section = typeof e.source_section === "string" && e.source_section.trim() ? e.source_section.trim() : null;
    accepted.push({
      term_key: key,
      value: normalized.value,
      unit: def.kind === "number" ? def.unit! : def.kind === "schedule" ? "pct" : null,
      quoted_text: quote,
      source_section: section,
      confidence: CONFIDENCES.includes(e.confidence as Confidence) ? (e.confidence as Confidence) : "low",
      verification: verify(def, normalized.value, quote, section, parts),
    });
  }

  // One row per distinct value, keeping its best-verified occurrence.
  const byKey = new Map<string, Map<string, StatedTerm>>();
  for (const term of accepted) {
    const values = byKey.get(term.term_key) ?? new Map<string, StatedTerm>();
    const id = canonical(term.value);
    const held = values.get(id);
    if (!held || VERIFICATION_RANK[term.verification] < VERIFICATION_RANK[held.verification]) values.set(id, term);
    byKey.set(term.term_key, values);
  }

  const stated = [...byKey.values()].flatMap((values) => [...values.values()]);
  const conflicts = [...byKey.entries()].filter(([, values]) => values.size > 1).map(([key]) => key);
  const attempted = new Set([...byKey.keys(), ...rejected.map((r) => r.term_key)]);

  return {
    catalog_version: catalog.version,
    stated,
    not_stated: catalog.terms.map((t) => t.key).filter((key) => !attempted.has(key)),
    rejected,
    conflicts,
  };
}
