"use client";

import { useState, type ReactNode } from "react";
import type { Finding } from "./finding-card";
import { SEVERITY_STYLE } from "./finding-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Meta, Subtitle } from "@/components/ui/typography";
import { useToast } from "@/components/ui/toast";
import { currencyOf } from "@/lib/exposure";
import { findingCategory, type ClauseGroup } from "@/lib/findings-overview";
import { clauseLabel, formatCurrency } from "@/lib/format";

/**
 * Every finding on one clause, in one card.
 *
 * A review raises several findings on a clause, such as one per tier of a
 * cancellation schedule, and each used to be its own card. Here they sit
 * together under the clause's name. Each change still shows in full and keeps
 * its own Accept, Edit and Dismiss, so the associate decides every one.
 *
 * "Accept all in this clause" accepts the undecided business changes of this
 * clause and no other. It records one accept per change, the same as clicking
 * each.
 */
export default function ClauseCard({
  group,
  renderFinding,
  onActionRecorded,
}: {
  group: ClauseGroup<Finding>;
  /** Draws one change. `nested` is true when it sits inside a clause card with others. */
  renderFinding: (finding: Finding, nested: boolean) => ReactNode;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const { findings } = group;

  // A clause with one finding reads best as the plain card it always was.
  if (findings.length === 1) return <>{renderFinding(findings[0], false)}</>;

  const style = SEVERITY_STYLE[group.severity];
  const undecided = findings.filter((f) => !f.current_action);
  const isBusiness = findingCategory(findings[0]) === "business";
  const withExposure = findings.filter((f) => f.exposure_amount != null && f.current_action?.action !== "dismiss");
  const exposure = withExposure.reduce((sum, f) => sum + (f.exposure_amount ?? 0), 0);

  async function acceptAll() {
    setSaving(true);
    let failed = 0;
    for (const finding of undecided) {
      try {
        const res = await fetch(`/api/findings/${finding.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "accept" }),
        });
        if (!res.ok) {
          failed++;
          continue;
        }
        onActionRecorded(finding.id, { action: "accept", edited_language: null, dismissal_reason: null });
      } catch {
        failed++;
      }
    }
    setSaving(false);
    const accepted = undecided.length - failed;
    if (failed > 0) showToast(`${accepted} accepted. ${failed} could not be saved, so try those again.`, "error");
    else showToast(`${accepted} changes accepted in ${clauseLabel(group.clause_type)}.`);
  }

  return (
    <Card
      padding="none"
      role="group"
      aria-label={`${clauseLabel(group.clause_type)}, ${findings.length} changes`}
      style={{ borderLeftWidth: style.borderWidth, borderLeftColor: style.borderColor }}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <Meta as="p" className="text-[var(--text-secondary)]">
            <span className="font-semibold" style={{ color: style.textColor }}>
              {style.label}
            </span>
            {" · "}
            {findings.length} changes
            {" · "}
            {undecided.length === 0 ? "all decided" : `${undecided.length} to decide`}
          </Meta>
          <Subtitle as="h3" className="text-[var(--text-primary)]">
            {clauseLabel(group.clause_type)}
          </Subtitle>
          {withExposure.length > 0 && (
            <Meta as="p" className="text-[var(--text-secondary)] [font-variant-numeric:tabular-nums]">
              {formatCurrency(exposure, currencyOf(withExposure[0].exposure_formula))} exposure
            </Meta>
          )}
        </div>
        {isBusiness && undecided.length > 1 && (
          <Button size="sm" variant="secondary" onClick={acceptAll} loading={saving} loadingText="Accepting..." className="shrink-0">
            Accept all {undecided.length} in this clause
          </Button>
        )}
      </div>
      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {findings.map((finding) => (
          <div key={finding.id}>{renderFinding(finding, true)}</div>
        ))}
      </div>
    </Card>
  );
}
