import { SEVERITY_ORDER } from "./types";
import type { ContractResult, ScoreReport } from "./types";

/**
 * Rendering a score report (MASTER_PLAN.md §2.0.1).
 *
 * One accuracy number is not a result anyone can act on. Missing a high-severity
 * finding and over-calling a note are both "wrong" and lead to opposite fixes,
 * so the rates are broken out by severity band, by clause type, by document and
 * by the attribute that failed.
 *
 * The audit trail is part of the output rather than a debugging aid. A rate
 * nobody can check against the pairings behind it is the failure this section
 * exists to prevent, so `--audit` prints every pairing, every miss and every
 * false positive with the wording on both sides.
 */

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pad = (s: string, width: number) => s.padEnd(width);
const num = (n: number, width: number) => String(n).padStart(width);

function rule(width = 78) {
  return "-".repeat(width);
}

function heading(title: string): string[] {
  return ["", title.toUpperCase(), rule()];
}

/** One line per bucket, so the reader can recompute every rate above from it. */
function detectionLines(report: ScoreReport): string[] {
  const d = report.detection;
  return [
    ...heading("Detection"),
    `Key items            ${num(d.key_items, 5)}`,
    `Matched              ${num(d.matched, 5)}`,
    `Missed               ${num(d.missed, 5)}   nothing pointed at these`,
    `Conflated            ${num(d.conflated, 5)}   a matched finding already covered the wording`,
    `Duplicates           ${num(d.duplicates, 5)}   the same issue reported twice`,
    `Spurious             ${num(d.spurious, 5)}   flagged, and the key says there was nothing there`,
    `Unscored             ${num(d.unscored, 5)}   the key does not claim to be exhaustive here`,
    "",
    `Recall               ${pct(d.recall)}`,
    `Precision            ${pct(d.precision)}   duplicates and spurious count against it; unscored does not`,
    `F1                   ${pct(d.f1)}`,
    `Weighted recall      ${pct(report.weighted_recall)}   high-severity misses cost eight times a note`,
  ];
}

function severityLines(report: ScoreReport): string[] {
  const lines = [
    ...heading("Recall by severity"),
    // A single weighted number hides which band failed, so both are reported.
    `${pad("Band", 10)}${pad("Items", 8)}${pad("Found", 8)}Recall`,
  ];
  for (const row of report.by_severity) {
    lines.push(`${pad(row.severity, 10)}${pad(String(row.key_items), 8)}${pad(String(row.matched), 8)}${pct(row.recall)}`);
  }
  return lines;
}

function attributeLines(report: ScoreReport): string[] {
  const a = report.attributes;
  if (a.graded === 0) return [...heading("Attributes"), "No pairs to grade."];

  const rate = (n: number) => `${pct(n / a.graded)} (${n}/${a.graded})`;

  const lines = [
    ...heading("Attributes, on matched pairs only"),
    `Clause type correct  ${rate(a.clause_type_correct)}`,
    `Presence correct     ${rate(a.presence_correct)}`,
    `Severity exact       ${rate(a.severity_exact)}`,
    `Severity within one  ${rate(a.severity_within_one)}`,
    `  over-called        ${a.severity_over_called}`,
    `  under-called       ${a.severity_under_called}`,
    a.language_graded === 0
      ? `Language             not graded — the key asserts nothing checkable on any matched pair`
      : `Language             ${pct(a.language_passed / a.language_graded)} (${a.language_passed}/${a.language_graded} pairs where the key asserts something checkable)`,
    "",
    "Quoted text",
  ];

  for (const [verdict, count] of Object.entries(a.quote)) {
    if (count === 0) continue;
    const note =
      verdict === "unlocatable"
        ? "   quote is not in the document — the redline engine could not place it either"
        : verdict === "ambiguous"
          ? "   quote appears several times and the section reference did not separate them"
          : "";
    lines.push(`  ${pad(verdict, 18)}${num(count, 4)}${note}`);
  }

  lines.push("", "Exposure");
  for (const [verdict, count] of Object.entries(a.exposure)) {
    if (count === 0) continue;
    const note = verdict === "invented" ? "   a figure the contract does not support — the prompt forbids this" : "";
    lines.push(`  ${pad(verdict, 18)}${num(count, 4)}${note}`);
  }

  lines.push("", "Severity called, by the severity the key expects");
  lines.push(`  ${pad("key \\ model", 14)}${SEVERITY_ORDER.map((s) => pad(s, 9)).join("")}`);
  for (const expected of SEVERITY_ORDER) {
    const row = a.severity_confusion[expected];
    if (SEVERITY_ORDER.every((s) => row[s] === 0)) continue;
    lines.push(`  ${pad(expected, 14)}${SEVERITY_ORDER.map((s) => pad(String(row[s]), 9)).join("")}`);
  }

  return lines;
}

function clauseTypeLines(report: ScoreReport): string[] {
  const lines = [
    ...heading("By clause type"),
    `${pad("Clause", 30)}${pad("Items", 7)}${pad("Found", 7)}${pad("Recall", 9)}${pad("Spurious", 10)}Named right`,
  ];

  // Worst recall first — the point of this table is finding what the review is
  // blind to, and alphabetical order buries it.
  const rows = [...report.by_clause_type].sort(
    (a, b) => a.recall - b.recall || b.key_items - a.key_items || a.clause_type.localeCompare(b.clause_type)
  );

  for (const row of rows) {
    lines.push(
      pad(row.clause_type, 30) +
        pad(String(row.key_items), 7) +
        pad(String(row.matched), 7) +
        pad(row.key_items ? pct(row.recall) : "-", 9) +
        pad(String(row.spurious), 10) +
        (row.matched ? pct(row.clause_type_accuracy) : "-")
    );
  }
  return lines;
}

function contractLines(report: ScoreReport): string[] {
  const lines = [
    ...heading("By contract"),
    `${pad("Contract", 26)}${pad("Items", 7)}${pad("Found", 7)}${pad("Recall", 9)}${pad("Extra", 7)}Not checked`,
  ];

  for (const contract of report.contracts) {
    if (contract.error) {
      lines.push(`${pad(contract.contract, 26)}FAILED — ${contract.error}`);
      continue;
    }
    const items = contract.matched.length + contract.missed.length;
    const extra = contract.unmatched.filter((u) => u.outcome !== "unscored").length;
    lines.push(
      pad(contract.contract, 26) +
        pad(String(items), 7) +
        pad(String(contract.matched.length), 7) +
        pad(items ? pct(contract.matched.length / items) : "-", 9) +
        pad(String(extra), 7) +
        String(contract.coverage.not_checked.length)
    );
  }
  return lines;
}

const clip = (s: string | null, width = 88) => {
  if (!s) return "(none)";
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
};

function auditLines(contract: ContractResult): string[] {
  const lines = ["", rule(), `AUDIT — ${contract.contract}`, rule()];

  if (contract.error) {
    lines.push(`Failed: ${contract.error}`);
    return lines;
  }

  lines.push("", `Matched (${contract.matched.length})`);
  for (const pair of contract.matched) {
    const g = pair.grade;
    const wrong = [
      g.clause_type === "wrong" ? `clause type (${pair.finding_clause_type})` : "",
      g.presence === "wrong" ? "presence" : "",
      g.severity.verdict !== "exact" ? `severity ${g.severity.verdict} (${pair.finding_severity})` : "",
      g.quote === "unlocatable" || g.quote === "ambiguous" ? `quote ${g.quote}` : "",
      g.exposure === "invented" || g.exposure === "out_of_tolerance" ? `exposure ${g.exposure}` : "",
      !g.language.passed ? "language" : "",
    ].filter(Boolean);

    lines.push(
      `  ${pair.key_item_id}  <- finding #${pair.finding_index}  [${pair.basis}, overlap ${pct(pair.overlap_fraction)}]`
    );
    lines.push(`      key   : ${clip(pair.key_anchor_texts[0] ?? null)}`);
    lines.push(`      model : ${clip(pair.finding_quoted_text)}`);
    lines.push(`      wrong : ${wrong.length ? wrong.join(", ") : "nothing"}`);
  }

  lines.push("", `Missed (${contract.missed.length})`);
  for (const miss of contract.missed) {
    const why = miss.conflated_with === null ? "not noticed" : `covered by finding #${miss.conflated_with}`;
    lines.push(`  ${miss.key_item_id}  [${miss.severity}, ${miss.kind}]  ${why}`);
    lines.push(`      key   : ${clip(miss.anchor_texts[0] ?? null)}`);
  }

  lines.push("", `Unmatched findings (${contract.unmatched.length})`);
  for (const extra of contract.unmatched) {
    lines.push(
      `  #${extra.finding_index}  ${extra.outcome}  [${extra.clause_type}, ${extra.severity}]` +
        (extra.duplicate_of ? `  duplicates ${extra.duplicate_of}` : "")
    );
    lines.push(`      model : ${clip(extra.quoted_text)}`);
    if (extra.location.status !== "located") {
      lines.push(`      where : ${extra.location.status}`);
    }
  }

  return lines;
}

export interface RenderOptions {
  /** Print every pairing, miss and false positive with the wording on both sides. */
  audit?: boolean;
}

export function renderReport(report: ScoreReport, options: RenderOptions = {}): string {
  const lines: string[] = [
    rule(),
    `EVAL REPORT — ${report.key_source} key ${report.key_version}`,
    rule(),
    `Run           ${report.run_id}  (${report.run_created_at})`,
    `Model         ${report.model_id}`,
    `Standards     ${report.standards_version}`,
    `Scored        ${report.scored_at}`,
  ];

  if (report.standards_mismatch) {
    lines.push(
      "",
      `WARNING: ${report.standards_mismatch}.`,
      "The model was measured against expectations derived from a library it was not given."
    );
  }

  if (report.key_source === "synthetic") {
    lines.push(
      "",
      "This key is synthetic. It measures whether the pipeline applies the standards",
      "it is handed, not whether CD's positions are right. Only a senior associate's",
      "review answers the second question."
    );
  }

  lines.push(
    ...detectionLines(report),
    ...severityLines(report),
    ...attributeLines(report),
    ...clauseTypeLines(report),
    ...contractLines(report)
  );

  if (options.audit) {
    for (const contract of report.contracts) lines.push(...auditLines(contract));
  } else {
    lines.push("", "Run again with --audit to see every pairing behind these numbers.");
  }

  return `${lines.join("\n")}\n`;
}
