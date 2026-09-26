import { NumberingResolver, loadDocx, walkPart, type ParsedPart, type WalkResult } from "../docx";
import type { RedlineEngineResult, UnappliedFinding, UnappliedReason, WidenedChange } from "../redline-validation/types";
import { assessApplicability } from "./applicability";
import { fitToProposal } from "./fit";
import { RevisionIds } from "./ids";
import { locateQuote } from "./locate";
import { appendClauses } from "./paragraphs";
import { dropRestated, rewritesExistingWording, struckSentences } from "./restated";
import { replaceSpan } from "./revise";
import { runsForSpan } from "./runs";
import { replaceTable } from "./tables";
import { serializePart } from "./serialize";
import { wordingProblem } from "./wording";
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
const REASON_FOR: Record<Exclude<Applicability, "applicable" | "blocked_wording">, UnappliedReason> = {
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

/** The opening of a sentence, for naming it in a resolution detail. */
function excerpt(sentence: string): string {
  const opening = sentence.split(/\s+/).slice(0, 8).join(" ");
  return opening.length < sentence.trim().length ? `${opening.replace(/[,;:]$/, "")}…` : opening;
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
  const widened: WidenedChange[] = [];
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

  // Clauses the contract does not have, appended together at the end (§1.5.8)
  // rather than one appendix per finding.
  const toAppend: string[] = [];

  // The contract as it arrived, for spotting wording a proposal repeats. A
  // proposal keeps any sentence another finding strikes, or the contract
  // would lose it altogether.
  const contractText = pristine.map((p) => p.text).join("\n");
  const struckByBatch = struckSentences(findings);

  const leavesOut = ({ dropped, reworded }: { dropped: string[]; reworded: string[] }) =>
    (dropped.length === 0
      ? ""
      : ` Leaves out ${dropped.length === 1 ? "a sentence" : `${dropped.length} sentences`} the contract already has.`) +
    reworded
      .map((s) => ` Leaves out a rewrite of wording it doesn't quote: "${excerpt(s)}". Edit the finding to change that sentence.`)
      .join("");

  const append = (finding: RevisionFinding) => {
    const problem = wordingProblem(finding.language, null);
    if (problem) {
      refuse(finding, problem.reason, "unresolved", "blocked_wording", problem.detail);
      return;
    }
    // Appending a rewrite of an existing clause would leave both versions in
    // the contract, contradicting each other.
    if (rewritesExistingWording(finding.language, contractText)) {
      refuse(
        finding,
        "unquoted_rewrite",
        "unresolved",
        "blocked_wording",
        "The proposal opens with wording already in the contract, and the finding quotes nothing for it to replace."
      );
      return;
    }
    const restated = dropRestated(finding.language.trim(), contractText, struckByBatch);
    const { language } = restated;
    if (!language.trim()) {
      refuse(finding, "missing_clause", "unresolved", "applicable", "The finding proposes no language to add.");
      return;
    }
    toAppend.push(language.trim());
    appliedCount++;
    resolutions.push({
      findingId: finding.id,
      spanResolution: "unresolved",
      applicability: "applicable",
      detail: `Not in the contract — added to the appendix as a tracked insertion.${leavesOut(restated)}`,
    });
  };

  for (const finding of findings) {
    // A point raised without wording, such as a term outside the standards
    // library. Marking its quote against empty wording would strike it.
    if (!finding.language.trim()) {
      refuse(finding, "no_wording", "unresolved", "blocked_wording", "No wording was proposed for this point.");
      continue;
    }

    // A quote says where the change belongs, even on a finding marked missing.
    if (!finding.quoted_text) {
      append(finding);
      continue;
    }

    const parts = walk();
    const located = locateQuote(parts, finding.quoted_text, finding.location_section);
    if (!isLocated(located) && finding.is_missing_clause) {
      append(finding);
      continue;
    }
    if (!isLocated(located)) {
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
        refuse(
          finding,
          located.ambiguous ? "ambiguous_quote" : "not_located",
          "unresolved",
          "blocked_cross_paragraph",
          located.reason
        );
      }
      continue;
    }

    const problem = wordingProblem(finding.language, finding.quoted_text);
    if (problem) {
      refuse(finding, problem.reason, located.resolution, "blocked_wording", problem.detail);
      continue;
    }

    const part = parts.find((p) => p.part === located.part)!;
    const fit = fitToProposal(part, located, finding.language);
    const { span } = fit;
    const restated = dropRestated(fit.language, contractText, [
      ...struckByBatch,
      part.text.slice(span.start, span.end),
    ]);
    const { language } = restated;
    const struck = fit.widened
      ? [fit.widened.before, fit.widened.after].map((s) => s.trim()).filter(Boolean).join(" … ")
      : "";

    // Recorded once the change is actually made, so the associate is asked to
    // check only wording the file really strikes.
    const applied = (detail: string) => {
      appliedCount++;
      if (struck) {
        widened.push({ clause_type: finding.clause_type, severity: finding.severity, quoted_text: finding.quoted_text, struck });
      }
      resolutions.push({
        findingId: finding.id,
        spanResolution: span.resolution,
        applicability: "applicable",
        detail:
          (struck ? `${detail} Covers the whole sentence, so it also strikes: "${struck}".` : detail) + leavesOut(restated),
      });
    };

    const verdict = assessApplicability(part, span);
    if (verdict.applicability !== "applicable") {
      refuse(finding, REASON_FOR[verdict.applicability], span.resolution, verdict.applicability, verdict.detail);
      continue;
    }

    if (verdict.strategy === "table_replacement") {
      const replaced = replaceTable({ part, span, replacement: language, author, date, ids });
      if (!replaced.ok) {
        refuse(finding, "crosses_boundary", span.resolution, "blocked_table", replaced.reason);
        continue;
      }
      editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
      walked = null;
      applied(verdict.detail);
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

    replaceSpan({ covered, replacement: language, author, date, ids });
    editedParts.add(pkg.textParts.find((p) => p.name === span.part)!);
    walked = null; // the document changed
    applied(verdict.detail);
  }

  if (toAppend.length) {
    appendClauses({ part: pkg.document, clauses: toAppend, author, date, ids });
    editedParts.add(pkg.document);
  }

  for (const part of editedParts) pkg.zip.file(part.path, serializePart(part));
  const docxBytes = await pkg.zip.generateAsync({ type: "uint8array" });

  return { docxBytes, appliedCount, unapplied, widened, ownRevisionIds: ids.ownRevisionIds, resolutions };
}
