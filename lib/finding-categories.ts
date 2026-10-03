import type { Finding, Severity } from "./anthropic";
import type { Category, StandardEntry } from "./standards/types";
import { OTHER_CLAUSE_TYPE } from "./other-findings";
import { sanitizeNote } from "./redline-comments/note-guard";

/**
 * Every finding's category comes from the library, never from the model.
 *
 * CD gives no legal advice, so a legal finding explains the risk and never
 * carries contract wording. The model is asked to write none, its answer
 * form has no wording field for these findings, and this module strips any
 * that arrives anyway. The database refuses legal wording as a last check.
 *
 * A clause type the library doesn't know is treated as other, so a misspelled
 * legal clause can't arrive with wording attached.
 */

export interface CategorizedFinding extends Finding {
  category: Category;
  /** CD's fallback on a business standard, for the associate only. Empty for every other category. */
  compromise_range: string;
  /** The redline comment, after the content check. Empty when it failed, and for every non-business finding. */
  redline_note: string;
}

const normalize = (clauseType: string) => clauseType.trim().toLowerCase().replace(/[\s-]+/g, "_");

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const SEVERITIES: Severity[] = ["high", "medium", "low"];

/**
 * Findings on legal and other clause types, which the model records without
 * wording. CD's standard on the card is the library's own position text.
 */
export function toFlaggedFindings(value: unknown, standards: StandardEntry[]): Finding[] {
  if (!Array.isArray(value)) return [];
  const positions = new Map(standards.map((s) => [normalize(s.clause_type), s.position]));

  return value
    .map((item): Finding | null => {
      const raw = (item ?? {}) as Record<string, unknown>;
      const clause_type = text(raw.clause_type);
      const finding_text = text(raw.finding_text);
      if (!clause_type || !finding_text) return null;

      const quoted = text(raw.quoted_text);
      const severity = SEVERITIES.includes(raw.severity as Severity) ? (raw.severity as Severity) : "medium";
      const confidence = ["high", "medium", "low"].includes(raw.model_confidence as string)
        ? (raw.model_confidence as Finding["model_confidence"])
        : "medium";

      return {
        clause_type,
        is_missing_clause: raw.is_missing_clause === true,
        severity,
        location_section: text(raw.location_section) || null,
        quoted_text: quoted || null,
        exposure_amount: null,
        exposure_formula: null,
        exposure_basis: null,
        headline: text(raw.headline) || null,
        finding_text,
        cd_standard: positions.get(normalize(clause_type)) ?? "",
        proposed_language: "",
        model_confidence: confidence,
      };
    })
    .filter((f): f is Finding => f !== null);
}

export function applyCategories(findings: Finding[], standards: StandardEntry[]): CategorizedFinding[] {
  const library = new Map(standards.map((s) => [normalize(s.clause_type), s]));

  return findings.map((finding) => {
    const standard = library.get(normalize(finding.clause_type));
    const category: Category = standard?.category ?? "other";

    if (category === "business") {
      const compromise_range = standard?.compromise_range ?? "";
      const redline_note = sanitizeNote(finding.redline_note, {
        cd_standard: finding.cd_standard,
        finding_text: finding.finding_text,
        compromise_range,
      });
      if (finding.redline_note?.trim() && !redline_note) {
        console.warn(`[finding-categories] blanked a redline note on ${finding.clause_type} that failed the content check`);
      }
      return { ...finding, category, compromise_range, redline_note };
    }

    if (finding.proposed_language && finding.clause_type !== OTHER_CLAUSE_TYPE) {
      console.warn(`[finding-categories] stripped wording from a ${category} finding on ${finding.clause_type}`);
    }
    return { ...finding, category, compromise_range: "", proposed_language: "", redline_note: "" };
  });
}
