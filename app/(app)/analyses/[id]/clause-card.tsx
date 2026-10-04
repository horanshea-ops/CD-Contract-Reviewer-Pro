"use client";

import type { ReactNode } from "react";
import type { Finding } from "./finding-card";
import { SEVERITY_STYLE } from "./finding-card";
import { Card } from "@/components/ui/card";
import { Meta, Subtitle } from "@/components/ui/typography";
import { currencyOf } from "@/lib/exposure";
import type { ClauseGroup } from "@/lib/findings-overview";
import { clauseLabel, formatCurrency } from "@/lib/format";

/**
 * Every finding on one clause, in one card.
 *
 * A review raises several findings on a clause, such as one per tier of a
 * cancellation schedule, and each used to be its own card. Here they sit
 * together under the clause's name. Each change still shows in full and keeps
 * its own Accept, Edit and Dismiss. The card has no control that decides
 * several changes at once, so the associate reads and decides every one.
 */
export default function ClauseCard({
  group,
  renderFinding,
}: {
  group: ClauseGroup<Finding>;
  /** Draws one change. `nested` is true when it sits inside a clause card with others. */
  renderFinding: (finding: Finding, nested: boolean) => ReactNode;
}) {
  const { findings } = group;

  // A clause with one finding reads best as the plain card it always was.
  if (findings.length === 1) return <>{renderFinding(findings[0], false)}</>;

  const style = SEVERITY_STYLE[group.severity];
  const undecided = findings.filter((f) => !f.current_action);
  const withExposure = findings.filter((f) => f.exposure_amount != null && f.current_action?.action !== "dismiss");
  const exposure = withExposure.reduce((sum, f) => sum + (f.exposure_amount ?? 0), 0);

  return (
    <Card
      padding="none"
      role="group"
      aria-label={`${clauseLabel(group.clause_type)}, ${findings.length} changes`}
      style={{ borderLeftWidth: style.borderWidth, borderLeftColor: style.borderColor }}
    >
      <div className="px-4 pt-3 pb-2">
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
      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {findings.map((finding) => (
          <div key={finding.id}>{renderFinding(finding, true)}</div>
        ))}
      </div>
    </Card>
  );
}
