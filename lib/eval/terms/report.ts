import type { TermValue } from "../../terms/types";
import { NOT_IN_RUN, NOT_STATED, type KeyedValue, type TermsScoreReport, type TermsTally } from "./types";

/**
 * The term extraction report, as plain text (MASTER_PLAN.md §2.0.2).
 *
 * Silent-wrong comes first because it is the number that decides whether a
 * downstream calculation can trust this layer. A missed term shows up as a gap;
 * a wrong one that passed verification shows up as a confident wrong answer.
 */

const pct = (n: number, d: number) => (d === 0 ? "  –  " : `${((100 * n) / d).toFixed(1).padStart(5)}%`);

function show(value: KeyedValue | TermValue): string {
  if (value === NOT_STATED) return "not stated";
  if (Array.isArray(value)) {
    return value
      .map((t) => `${t.days_prior_min}–${t.days_prior_max ?? "∞"}d: ${Math.round(t.pct * 1000) / 10}%`)
      .join(", ");
  }
  return JSON.stringify(value);
}

function tallyLines(t: TermsTally): string[] {
  return [
    `Values the contracts state         ${String(t.keyed_values).padStart(4)}`,
    `  correct                          ${String(t.correct).padStart(4)}  ${pct(t.correct, t.keyed_values)}`,
    `  wrong value                      ${String(t.wrong_value).padStart(4)}  ${pct(t.wrong_value, t.keyed_values)}`,
    `  conflicting values               ${String(t.conflict).padStart(4)}  ${pct(t.conflict, t.keyed_values)}`,
    `  missed                           ${String(t.missed).padStart(4)}  ${pct(t.missed, t.keyed_values)}`,
    `Terms the contracts do not state   ${String(t.keyed_absent).padStart(4)}`,
    `  correctly left out               ${String(t.correct_absent).padStart(4)}  ${pct(t.correct_absent, t.keyed_absent)}`,
    `  invented                         ${String(t.invented).padStart(4)}  ${pct(t.invented, t.keyed_absent)}`,
  ];
}

export function renderTermsReport(report: TermsScoreReport, { audit = false }: { audit?: boolean } = {}): string {
  const out: string[] = [];
  const t = report.tally;
  const v = report.verification;

  out.push(`TERM EXTRACTION — run ${report.run_id} against ${report.key_version} (${report.key_source} key)`);
  out.push(`Model ${report.model_id} · catalog ${report.catalog_version} · captured ${report.run_created_at}`);
  const inRun = report.contracts.filter((c) => c.error !== NOT_IN_RUN).length;
  out.push(`Contracts scored: ${inRun} of ${report.contracts.length} in the key`);
  if (report.catalog_mismatch) out.push(`WARNING: ${report.catalog_mismatch}`);
  out.push("");
  out.push(`SILENT WRONG: ${t.silent_wrong} — wrong or invented values that passed verification`);
  out.push("");
  out.push(...tallyLines(t));
  out.push("");
  out.push(
    `Verification of every stored value: verified ${v.verified} · located ${v.located} · ` +
      `contradicted ${v.contradicted} · unlocated ${v.unlocated}`
  );
  out.push("");

  out.push("BY KIND                keyed   correct   wrong   missed   invented");
  for (const { kind, tally } of report.by_kind) {
    out.push(
      `  ${kind.padEnd(20)} ${String(tally.keyed_values + tally.keyed_absent).padStart(5)}  ` +
        `${pct(tally.correct + tally.correct_absent, tally.keyed_values + tally.keyed_absent)}   ` +
        `${String(tally.wrong_value + tally.conflict).padStart(5)}   ${String(tally.missed).padStart(6)}   ${String(tally.invented).padStart(8)}`
    );
  }
  out.push("");

  out.push("BY CONTRACT                     correct   wrong   missed   invented   silent   rejected   out tokens");
  for (const c of report.contracts) {
    if (c.error === NOT_IN_RUN) {
      out.push(`  ${c.contract.padEnd(28)} not in this run`);
      continue;
    }
    if (c.error) {
      out.push(`  ${c.contract.padEnd(28)} FAILED — ${c.error}`);
      continue;
    }
    const ct = c.tally;
    out.push(
      `  ${c.contract.padEnd(28)} ${`${ct.correct}/${ct.keyed_values}`.padStart(7)}   ${String(ct.wrong_value + ct.conflict).padStart(5)}   ` +
        `${String(ct.missed).padStart(6)}   ${String(ct.invented).padStart(8)}   ${String(ct.silent_wrong).padStart(6)}   ` +
        `${String(c.rejected).padStart(8)}   ${String(c.tokens?.output ?? 0).padStart(10)}`
    );
  }
  out.push(`\nTokens — input ${report.tokens.input.toLocaleString()}, output ${report.tokens.output.toLocaleString()}, cache read ${report.tokens.cache_read.toLocaleString()}`);

  if (audit) {
    out.push("\nAUDIT — every term not scored correct");
    for (const c of report.contracts) {
      const wrong = c.results.filter((r) => r.outcome !== "correct" && r.outcome !== "correct_absent");
      if (wrong.length === 0) continue;
      out.push(`\n  ${c.contract}`);
      for (const r of wrong) {
        out.push(`    ${r.outcome.toUpperCase()}${r.silent_wrong ? " (SILENT)" : ""}  ${r.term_key}`);
        out.push(`      expected ${show(r.expected)}`);
        for (const g of r.got) {
          out.push(`      got      ${show(g.value)}  [${g.verification}]  "${g.quoted_text}"`);
        }
      }
    }
  }

  return `${out.join("\n")}\n`;
}
