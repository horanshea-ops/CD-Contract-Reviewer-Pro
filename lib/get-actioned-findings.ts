import type { createAdminClient } from "./supabase/admin";
import type { RevisionFinding } from "./redline-engine/types";
import { assertsNoChange } from "./proposed-language";
import type { CounselItem, MemoFinding } from "./export-memo";
import { latestActions } from "./finding-actions";
import { findingCategory } from "./findings-overview";

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, note: 3 };

/**
 * Fetches every accepted/edited finding for an analysis, in the shape the
 * export formats need. The associate's edited language where they edited,
 * otherwise the model's proposed language; dismissed and undecided findings
 * excluded; sorted by severity. Shared because every export route needs
 * exactly this.
 *
 * It carries the finding's id and section reference too. §1.5 needs the section
 * to tell two copies of the same wording apart, and the id to write back how
 * each one resolved; the memo and PDF exports ignore both.
 */
/**
 * An accepted change as the internal exports need it. It carries the rationale
 * and the standard, so it passes through `toRevisionFinding` before the engine.
 */
export type ActionedFinding = RevisionFinding & MemoFinding;

/** A finding accepted despite proposing no change. Excluded from every export. */
export interface NonSubstantiveFinding {
  clause_type: string;
  language: string;
}

export interface ActionedFindings {
  /** Changes to the contract that go into its files. Never holds a legal finding, or a change sent by email. */
  findings: ActionedFinding[];
  /** Accepted changes the associate chose to send in the email to the property, so no contract file carries them. */
  byEmail: ActionedFinding[];
  nonSubstantive: NonSubstantiveFinding[];
  /** Legal findings flagged for the client. They carry an explanation and no wording, and reach no contract export. */
  counsel: CounselItem[];
}

/**
 * Accepted and edited findings, in the shape the exports need, with anything
 * proposing no change held back — see lib/proposed-language.ts. Every export
 * lists changes, so a finding that is not one belongs in none of them.
 *
 * The held-back items are returned rather than dropped quietly, so a route can
 * record that they existed.
 */
export async function getActionedFindings(
  admin: ReturnType<typeof createAdminClient>,
  analysisId: string
): Promise<ActionedFindings> {
  const { data: findingRowsRaw } = await admin
    .from("findings")
    .select(
      "id, clause_type, severity, category, is_missing_clause, quoted_text, location_section, headline, finding_text, cd_standard, proposed_language"
    )
    .eq("analysis_id", analysisId);
  const findingRows = findingRowsRaw ?? [];
  type FindingRow = (typeof findingRows)[number];

  const latestActionByFinding = await latestActions(
    admin,
    findingRows.map((f) => f.id)
  );

  const actioned = findingRows
    .map((f) => ({ f, action: latestActionByFinding.get(f.id) }))
    .filter((x): x is { f: FindingRow; action: NonNullable<typeof x.action> } =>
      x.action != null && (x.action.action === "accept" || x.action.action === "edit")
    )
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity]);

  // CD gives no legal advice, so a legal finding is never a change, even one edited before categories existed.
  const isLegal = ({ f }: (typeof actioned)[number]) => findingCategory(f) === "legal";

  const counsel: CounselItem[] = actioned.filter(isLegal).map(({ f }) => ({
    clause_type: f.clause_type,
    severity: f.severity,
    is_missing_clause: f.is_missing_clause,
    quoted_text: f.quoted_text,
    headline: f.headline,
    finding_text: f.finding_text,
  }));

  const changes = actioned
    .filter((x) => !isLegal(x))
    .map(({ f, action }) => ({
      byEmail: action.by_email,
      finding: {
        id: f.id,
        location_section: f.location_section,
        clause_type: f.clause_type,
        severity: f.severity,
        is_missing_clause: f.is_missing_clause,
        // The wording the associate picked for the change, where they picked one.
        quoted_text: action.edited_quote ?? f.quoted_text,
        quote_context: action.quote_context,
        language: action.action === "edit" && action.edited_language ? action.edited_language : f.proposed_language,
        finding_text: f.finding_text,
        cd_standard: f.cd_standard,
      },
    }));

  const nonSubstantive = changes
    .filter((c) => assertsNoChange(c.finding.language))
    .map((c) => ({ clause_type: c.finding.clause_type, language: c.finding.language }));

  const substantive = changes.filter((c) => !assertsNoChange(c.finding.language));
  return {
    findings: substantive.filter((c) => !c.byEmail).map((c) => c.finding),
    byEmail: substantive.filter((c) => c.byEmail).map((c) => c.finding),
    nonSubstantive,
    counsel,
  };
}
