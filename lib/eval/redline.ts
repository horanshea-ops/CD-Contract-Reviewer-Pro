import { generateRedline, type RevisionFinding } from "../redline-engine";
import { validateRedline, type UnappliedReason } from "../redline-validation";
import { assertsNoChange } from "../proposed-language";
import type { RedlineContractResult, RedlineSummary, RunRecord } from "./types";

/**
 * The redline an associate would get from a run (MASTER_PLAN.md §2.0.1).
 *
 * Every finding is accepted as proposed, then marked up by the live engine and
 * checked by the §1.6 oracle, as the export route does. Findings that propose
 * no change are held back first, as every export holds them back.
 *
 * Free and deterministic, like the rest of scoring. The author and date are
 * fixed, so the same run always gives the same file.
 */

const AUTHOR = "Eval Associate";
const DATE = new Date("2026-01-01T00:00:00Z");

export async function redlineRun(run: RunRecord, originals: Map<string, Uint8Array>): Promise<RedlineSummary> {
  const contracts: RedlineContractResult[] = [];

  for (const document of run.documents) {
    if (!document.analysis) {
      contracts.push({
        contract: document.contract,
        findings: 0,
        held_back: 0,
        applied: 0,
        outcome: null,
        failed_checks: [],
        widened: [],
        unapplied: [],
      });
      continue;
    }

    const original = originals.get(document.contract);
    if (!original) throw new Error(`No DOCX supplied for "${document.contract}".`);

    const findings = document.analysis.findings;
    const kept = findings
      .map((f, index) => ({ f, index }))
      .filter(({ f }) => !assertsNoChange(f.proposed_language));

    const revisionFindings: RevisionFinding[] = kept.map(({ f, index }) => ({
      id: `${document.contract}#${index}`,
      clause_type: f.clause_type,
      severity: f.severity,
      is_missing_clause: f.is_missing_clause,
      quoted_text: f.quoted_text,
      language: f.proposed_language,
      finding_text: f.finding_text,
      cd_standard: f.cd_standard,
      location_section: f.location_section,
    }));

    const engineResult = await generateRedline({
      originalDocxBytes: original,
      findings: revisionFindings,
      author: AUTHOR,
      now: DATE,
    });
    const report = await validateRedline({ originalBytes: original, engineResult, author: AUTHOR });

    contracts.push({
      contract: document.contract,
      findings: findings.length,
      held_back: findings.length - kept.length,
      applied: report.appliedCount,
      outcome: report.outcome,
      failed_checks: report.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`),
      widened: report.widened,
      unapplied: report.unapplied,
    });
  }

  const sum = (pick: (c: RedlineContractResult) => number) => contracts.reduce((n, c) => n + pick(c), 0);

  const by_reason: Partial<Record<UnappliedReason, number>> = {};
  for (const u of contracts.flatMap((c) => c.unapplied)) by_reason[u.reason] = (by_reason[u.reason] ?? 0) + 1;

  const outcomes = { clean: 0, partial: 0, fallback: 0 };
  for (const c of contracts) if (c.outcome) outcomes[c.outcome] += 1;

  return {
    findings: sum((c) => c.findings),
    held_back: sum((c) => c.held_back),
    applied: sum((c) => c.applied),
    widened: sum((c) => c.widened.length),
    unapplied: sum((c) => c.unapplied.length),
    by_reason,
    failed_checks: sum((c) => c.failed_checks.length),
    outcomes,
    contracts,
  };
}
