import type { Finding } from "./anthropic";

/**
 * Terms outside the standards library that still cost the group.
 *
 * The library covers the clauses CD negotiates as a matter of course. A real
 * contract also carried a cross-default, a damages waiver protecting only the
 * hotel, and a right to demand prepayment on the hotel's own judgment, none of
 * which any library clause names. The model reports those separately, and
 * they become findings in the review's Other bucket.
 *
 * They carry no proposed wording. With no CD position behind them, any
 * wording would be the model's own, sent to the hotel under CD's name. The
 * associate adds wording with Edit when a point is worth changing.
 */

export const OTHER_CLAUSE_TYPE = "general";

const MAX_OTHER_FINDINGS = 6;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function toOtherFindings(value: unknown, firm: string): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): Finding | null => {
      const { headline, quoted_text, finding_text } = (item ?? {}) as Record<string, unknown>;
      if (!text(headline) || !text(quoted_text)) return null;
      return {
        clause_type: OTHER_CLAUSE_TYPE,
        is_missing_clause: false,
        severity: "note",
        location_section: null,
        quoted_text: text(quoted_text),
        exposure_amount: null,
        exposure_formula: null,
        exposure_basis: null,
        headline: text(headline),
        finding_text: text(finding_text) || text(headline),
        cd_standard: `Not covered by ${firm}'s standards library. Raise it at your discretion.`,
        proposed_language: "",
        model_confidence: "medium",
      };
    })
    .filter((f): f is Finding => f !== null)
    .slice(0, MAX_OTHER_FINDINGS);
}
