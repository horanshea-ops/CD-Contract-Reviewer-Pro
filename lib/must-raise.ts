import type { Finding } from "./anthropic";
import { positionsFrom, type CdPositions } from "./exposures/cd-positions";
import type { DealFigures } from "./exposures/figures";
import { numberToWords } from "./quantities";
import type { StandardEntry } from "./standards/types";
import type { ExtractedTerms, StatedTerm } from "./terms/types";

/**
 * Findings the app raises itself, from numbers it has read and checked.
 *
 * Whether a clause gets a finding is otherwise left to the judging call, which
 * can judge a clause short and then write nothing for it. For a term that is
 * one number, the app compares the number with CD's standard, as the library
 * states it, and raises
 * the finding when the judging call didn't. The model can no longer cause a
 * miss on these.
 *
 * The proposed wording is the contract's own sentence with the number
 * changed. It is a starting point for the associate, and it is offered only
 * when the number sits in the sentence once, so nothing else is disturbed.
 */

const percentOf = (fraction: number) => Number((fraction * 100).toFixed(4));
/** A share as a reader sees it: 78.6, not 78.6207. */
const shown = (fraction: number) => Number((fraction * 100).toFixed(1));
const grouped = (n: number) => n.toLocaleString("en-US");
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The sentence with one number changed, or null when the number isn't there exactly once. */
function swapOnce(quote: string, pattern: RegExp, replacement: string): string | null {
  const matches = [...quote.matchAll(new RegExp(pattern.source, "gi"))];
  if (matches.length !== 1) return null;
  const at = matches[0].index ?? 0;
  return quote.slice(0, at) + replacement + quote.slice(at + matches[0][0].length);
}

/** "eight percent (8%)" becomes "ten percent (10%)", and a bare "8%" becomes "10%". */
function swapPercent(quote: string, from: number, to: number): string | null {
  const [a, b] = [percentOf(from), percentOf(to)];
  if (Number.isInteger(a) && Number.isInteger(b) && a <= 999 && b <= 999) {
    const spelled = swapOnce(quote, new RegExp(`${escaped(numberToWords(a))}\\s+percent\\s*\\(\\s*${a}\\s*%\\s*\\)`), `${numberToWords(b)} percent (${b}%)`);
    if (spelled) return spelled;
  }
  return swapOnce(quote, new RegExp(`(?<![\\d.])${escaped(String(a))}\\s*%`), `${b}%`);
}

/** "2,280" or "2280" becomes "2,030". */
function swapCount(quote: string, from: number, to: number): string | null {
  return swapOnce(quote, new RegExp(`(?<![\\d,.])(?:${escaped(grouped(from))}|${from})(?![\\d,]*\\d)`), grouped(to));
}

interface Raised {
  clause_type: string;
  /** The term whose quote the finding stands on. */
  term_key: string;
  /** The number as the contract writes it, for telling whether a finding already covers it. */
  token: RegExp;
  headline: string;
  finding_text: string;
  /** The quote with the number changed, or null when it can't be changed cleanly. */
  wording: (quote: string) => string | null;
}

function raised(figures: DealFigures, p: CdPositions): Raised[] {
  const out: Raised[] = [];
  const percentToken = (fraction: number) => new RegExp(`(?<![\\d.])${escaped(String(percentOf(fraction)))}\\s*%`);

  const commission = figures.commission_pct;
  if (commission !== null && commission < p.commission - 1e-9) {
    out.push({
      clause_type: "commission",
      term_key: "commission.commission_pct",
      token: percentToken(commission),
      headline: `Commission is ${percentOf(commission)}%, below the ${percentOf(p.commission)}% standard`,
      finding_text: `The contract pays ${percentOf(commission)}% commission. The standard is ${percentOf(p.commission)}%.`,
      wording: (quote) => swapPercent(quote, commission, p.commission),
    });
  }

  const block = figures.room_block_room_nights;
  const minimum = figures.minimum_room_nights;
  const threshold = figures.attrition_threshold_pct;
  if (block !== null && minimum !== null) {
    const trigger = Math.round(block * p.attritionTrigger);
    if (minimum > trigger) {
      out.push({
        clause_type: "attrition",
        term_key: "attrition.minimum_room_nights",
        token: new RegExp(`(?<![\\d,.])(?:${escaped(grouped(minimum))}|${minimum})(?![\\d,]*\\d)`),
        headline: `Attrition floor is ${shown(minimum / block)}% of the block, above the ${percentOf(p.attritionTrigger)}% standard`,
        finding_text:
          `The group must use ${grouped(minimum)} of ${grouped(block)} room nights before damages stop. ` +
          `The standard is ${percentOf(p.attritionTrigger)}% of the block, which is ${grouped(trigger)} room nights.`,
        wording: (quote) => swapCount(quote, minimum, trigger),
      });
    }
  } else if (threshold !== null && threshold > p.attritionTrigger + 1e-9) {
    out.push({
      clause_type: "attrition",
      term_key: "attrition.threshold",
      token: percentToken(threshold),
      headline: `Attrition applies below ${percentOf(threshold)}% pickup, above the ${percentOf(p.attritionTrigger)}% standard`,
      finding_text: `Damages start below ${percentOf(threshold)}% of the block. The standard is ${percentOf(p.attritionTrigger)}%.`,
      wording: (quote) => swapPercent(quote, threshold, p.attritionTrigger),
    });
  }

  const shortfall = figures.fb_shortfall_pct;
  if (shortfall !== null && shortfall > p.fbShortfall + 1e-9) {
    out.push({
      clause_type: "fb_minimum",
      term_key: "fb_minimum.shortfall_rate",
      token: percentToken(shortfall),
      headline: `Food and beverage shortfall is charged at ${percentOf(shortfall)}%, above the ${percentOf(p.fbShortfall)}% standard`,
      finding_text:
        `The group pays ${percentOf(shortfall)}% of a food and beverage shortfall. The standard is ${percentOf(p.fbShortfall)}%. ` +
        `Check any dollar amount the contract states beside this percentage, since the wording below changes the percentage alone.`,
      wording: (quote) => swapPercent(quote, shortfall, p.fbShortfall),
    });
  }

  return out;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Whether a finding already written covers the number: it quotes the term's words, or it is on that clause and quotes the number. */
function covered(rule: Raised, term: StatedTerm, findings: Finding[]): boolean {
  const quote = flat(term.quoted_text);
  return findings.some((finding) => {
    const quoted = flat(finding.quoted_text ?? "");
    if (!quoted) return false;
    if (quote.length >= 12 && quoted.includes(quote)) return true;
    return finding.clause_type === rule.clause_type && rule.token.test(finding.quoted_text ?? "");
  });
}

export const APP_RAISED = "Raised by the app from the contract's numbers.";

export interface MustRaise {
  /** Findings to add to the review. */
  findings: Finding[];
  /** Numbers worse than the standard that no finding covers and the app couldn't write wording for. */
  uncovered: { clause_type: string; headline: string }[];
}

export function mustRaise(
  figures: DealFigures,
  terms: ExtractedTerms,
  findings: Finding[],
  standards: StandardEntry[],
  positions: CdPositions = positionsFrom(standards).positions
): MustRaise {
  const result: MustRaise = { findings: [], uncovered: [] };

  for (const rule of raised(figures, positions)) {
    const term = terms.stated.find((t) => t.term_key === rule.term_key && t.verification === "verified");
    if (!term || covered(rule, term, findings)) continue;

    const wording = rule.wording(term.quoted_text);
    if (!wording) {
      result.uncovered.push({ clause_type: rule.clause_type, headline: rule.headline });
      continue;
    }

    const standard = standards.find((s) => s.clause_type === rule.clause_type);
    result.findings.push({
      clause_type: rule.clause_type,
      is_missing_clause: false,
      severity: standard?.severity_default ?? "medium",
      location_section: term.source_section,
      quoted_text: term.quoted_text,
      exposure_amount: null,
      exposure_basis: null,
      exposure_formula: null,
      headline: rule.headline,
      finding_text: `${APP_RAISED} ${rule.finding_text}`,
      cd_standard: standard?.position ?? "",
      proposed_language: wording,
      model_confidence: "high",
    });
  }

  return result;
}
