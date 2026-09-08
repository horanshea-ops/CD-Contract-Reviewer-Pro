import { NumberingResolver, loadDocx, walkPart, type ParsedPart, type WalkResult } from "../docx";
import type { RedlineEngineResult, UnappliedFinding, UnappliedReason } from "../redline-validation/types";
import { assessApplicability } from "./applicability";
import { RevisionIds } from "./ids";
import { locateQuote } from "./locate";
import { replaceSpan } from "./revise";
import { runsForSpan } from "./runs";
import { serializePart } from "./serialize";
import { isLocated, type Applicability, type RevisionFinding, type SpanResolution } from "./types";

export * from "./types";

/**
 * The revision engine (MASTER_PLAN.md §1.5).
 *
 * Reads the uploaded document into a tree, finds the wording each finding
 * quotes, and writes real Word tracked changes into it. Only the parts it
 * actually edits are written back.
 *
 * Everything it produces goes through §1.6's oracle before an associate can
 * download it, so a mistake here becomes a fallback to the marked-up PDF rather
 * than a corrupt file sent to a hotel.
 */

/** What the associate is told, per applicability verdict. */
const REASON_FOR: Record<Exclude<Applicability, "applicable">, UnappliedReason> = {
  blocked_table: "crosses_boundary",
  blocked_content_control: "in_content_control",
  blocked_field: "in_field",
  blocked_cross_paragraph: "crosses_boundary",
  blocked_already_deleted: "overlaps_another_change",
};

export interface RedlineOutcome extends RedlineEngineResult {
  /** Per finding, for writing back to `findings` (§1.5.1, §1.5.3). */
  resolutions: {
    findingId: string;
    spanResolution: SpanResolution;
    applicability: Applicability;
    detail: string;
  }[];
}

/** Revision elements enclosing a run, outermost last. */
function revisionAncestors(run: Element): Element[] {
  const out: Element[] = [];
  let node: Node | null = run.parentNode;
  while (node && node.nodeType === 1) {
    const name = (node as Element).nodeName;
    if (name === "w:ins" || name === "w:del" || name === "w:moveFrom" || name === "w:moveTo") {
      out.push(node as Element);
    }
    node = node.parentNode;
  }
  return out;
}

export async function generateRedline({
  originalDocxBytes,
  findings,
  author,
  now = new Date(),
}: {
  originalDocxBytes: Uint8Array;
  findings: RevisionFinding[];
  author: string;
  now?: Date;
}): Promise<RedlineOutcome> {
  const pkg = await loadDocx(originalDocxBytes);
  const ids = new RevisionIds(pkg.textParts);
  const date = now.toISOString();

  const unapplied: UnappliedFinding[] = [];
  const resolutions: RedlineOutcome["resolutions"] = [];
  const editedParts = new Set<ParsedPart>();
  let appliedCount = 0;

  const refuse = (
    finding: RevisionFinding,
    reason: UnappliedReason,
    spanResolution: SpanResolution,
    applicability: Applicability,
    detail: string
  ) => {
    unapplied.push({
      clause_type: finding.clause_type,
      severity: finding.severity,
      quoted_text: finding.quoted_text,
      reason,
    });
    resolutions.push({ findingId: finding.id, spanResolution, applicability, detail });
  };

  const freshWalk = () => {
    const numbering = new NumberingResolver(pkg.numbering);
    return pkg.textParts.map((p) => walkPart(p, numbering));
  };

  // Re-walked whenever the document has changed under it, so a later finding
  // sees the contract as it now reads rather than as it arrived. The text and
  // map are snapshots, so the pristine one stays valid as the tree mutates.
  const pristine = freshWalk();
  let walked: WalkResult[] | null = pristine;
  const walk = () => (walked ??= freshWalk());

  for (const finding of findings) {
    if (finding.is_missing_clause || !finding.quoted_text) {
      refuse(finding, "missing_clause", "unresolved", "applicable", "The clause is not in the contract.");
      continue;
    }

    const parts = walk();
    const span = locateQuote(parts, finding.quoted_text, finding.location_section);
    if (!isLocated(span)) {
      // Wording that was there when the document arrived and is not there now
      // was struck by an earlier finding. Saying "could not be found" would be
      // true and useless; the associate needs to know which of their decisions
      // took precedence.
      const wasThere =
        appliedCount > 0 && isLocated(locateQuote(pristine, finding.quoted_text, finding.location_section));
      if (wasThere) {
        refuse(
          finding,
          "overlaps_another_change",
          "unresolved",
          "blocked_already_deleted",
          "Another finding already marks up overlapping wording."
        );
      } else {
        refuse(finding, "not_located", "unresolved", "blocked_cross_paragraph", span.reason);
      }
      continue;
    }

    const part = parts.find((p) => p.part === span.part)!;
    const verdict = assessApplicability(part, span);
    if (verdict.applicability !== "applicable") {
      refuse(finding, REASON_FOR[verdict.applicability], span.resolution, verdict.applicability, verdict.detail);
      continue;
    }

    if (verdict.strategy === "table_replacement") {
      // Wired up in the next step; refused rather than half-applied until then.
      refuse(finding, "crosses_boundary", span.resolution, "blocked_table", verdict.detail);
      continue;
    }

    const covered = runsForSpan(part, span);
    if (covered.length === 0) {
      refuse(finding, "not_located", span.resolution, "blocked_cross_paragraph", "The wording resolved to no editable runs.");
      continue;
    }

    // A finding whose wording overlaps one already marked up would nest an
    // edit inside our own, which reads as a change to a change. Refuse instead.
    const ours = new Set(ids.ownRevisionIds);
    const alreadyTouched = covered.some((run) =>
      revisionAncestors(run).some((el) => ours.has(el.getAttribute("w:id") ?? ""))
    );
    if (alreadyTouched) {
      refuse(
        finding,
        "overlaps_another_change",
        span.resolution,
        "blocked_already_deleted",
        "Another finding already marks up overlapping wording."
      );
      continue;
    }

    replaceSpan({ covered, replacement: finding.language, author, date, ids });
    editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
    walked = null; // the document changed
    appliedCount++;
    resolutions.push({
      findingId: finding.id,
      spanResolution: span.resolution,
      applicability: "applicable",
      detail: verdict.detail,
    });
  }

  for (const part of editedParts) pkg.zip.file(part.path, serializePart(part));
  const docxBytes = await pkg.zip.generateAsync({ type: "uint8array" });

  return { docxBytes, appliedCount, unapplied, ownRevisionIds: ids.ownRevisionIds, resolutions };
}
