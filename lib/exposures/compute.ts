import type { Finding } from "../anthropic";
import { evaluateFormula } from "../exposure";
import {
  ATTRITION_TRIGGER_OF_BLOCK,
  FB_SHORTFALL_RATE,
  ROOM_PROFIT_OF_RATE,
} from "./cd-positions";
import type { DealFigures } from "./figures";

/**
 * Exposure figures the app works out from the contract's checked figures.
 *
 * Each is the extra the group would owe under this contract compared with
 * CD's standard, in one stated situation:
 *
 * - Attrition: pickup lands exactly at CD's trigger, where CD's standard owes
 *   nothing and this contract charges for every night between its minimum and
 *   that trigger.
 * - Cancellation: the group cancels in the tier with the highest fee. The
 *   contract charges that share of the full rate, and CD's standard charges it
 *   of room profit.
 * - Food and beverage: none of the minimum is spent. Only computed when the
 *   contract states the share of a shortfall it charges.
 *
 * The formula is kept with the figure so the review card can show it.
 */

export interface ComputedExposure {
  amount: number;
  formula: string;
  basis: string;
}

const whole = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const symbolOf = (f: DealFigures) => f.currency ?? "$";
const percent = (fraction: number) => `${Number((fraction * 100).toFixed(4))}%`;

function result(formula: string, basis: string): ComputedExposure | null {
  const amount = evaluateFormula(formula);
  if (amount === null || amount <= 0) return null;
  return { amount: Math.round(amount * 100) / 100, formula, basis };
}

export function attritionExposure(f: DealFigures): ComputedExposure | null {
  const block = f.room_block_room_nights;
  const rate = f.group_rate;
  const damages = f.attrition_damages_pct;
  if (block === null || rate === null || damages === null) return null;

  const minimum =
    f.minimum_room_nights ?? (f.attrition_threshold_pct === null ? null : Math.round(f.attrition_threshold_pct * block));
  if (minimum === null) return null;
  const trigger = Math.round(block * ATTRITION_TRIGGER_OF_BLOCK);
  if (minimum <= trigger) return null;

  const sym = symbolOf(f);
  return result(
    `(${minimum} - ${trigger}) * ${sym}${rate} * ${damages}`,
    `At ${percent(ATTRITION_TRIGGER_OF_BLOCK)} pickup (${whole(trigger)} room nights), where CD's standard owes nothing, ` +
      `this contract charges for ${whole(minimum - trigger)} nights at ${percent(damages)} of ${sym}${whole(rate)}.`
  );
}

export function cancellationExposure(f: DealFigures): ComputedExposure | null {
  const rate = f.group_rate;
  if (rate === null) return null;

  const top = [...f.cancellation_tiers].sort((a, b) => b.room_pct - a.room_pct)[0];
  if (!top || top.charges !== "rate" || top.base === "other") return null;
  const nights = top.base === "minimum_room_nights" ? f.minimum_room_nights : f.room_block_room_nights;
  if (nights === null) return null;

  return result(
    `${nights} * ${symbolOf(f)}${rate} * ${top.room_pct} * (1 - ${ROOM_PROFIT_OF_RATE})`,
    `In the "${top.label}" tier, this contract charges ${percent(top.room_pct)} of the full rate on ${whole(nights)} room nights. ` +
      `CD's standard charges ${percent(top.room_pct)} of room profit, which is ${percent(ROOM_PROFIT_OF_RATE)} of the rate.`
  );
}

export function fbMinimumExposure(f: DealFigures): ComputedExposure | null {
  const minimum = f.fb_minimum;
  const shortfall = f.fb_shortfall_pct;
  if (minimum === null || shortfall === null || shortfall <= FB_SHORTFALL_RATE) return null;

  return result(
    `${symbolOf(f)}${minimum} * (${shortfall} - ${FB_SHORTFALL_RATE})`,
    `If none of the ${symbolOf(f)}${whole(minimum)} minimum is spent, this contract charges ${percent(shortfall)} of the shortfall. ` +
      `CD's standard charges ${percent(FB_SHORTFALL_RATE)}.`
  );
}

const CALCULATIONS: Partial<Record<string, (f: DealFigures) => ComputedExposure | null>> = {
  attrition: attritionExposure,
  cancellation: cancellationExposure,
  fb_minimum: fbMinimumExposure,
};

/**
 * Findings with the app's exposure figures. Each figure goes on the first
 * finding of its clause type, so a clause raised in several findings, such as
 * a schedule changed cell by cell, is counted once. Every other finding
 * carries none.
 */
export function withComputedExposures<T extends Finding>(findings: T[], figures: DealFigures): T[] {
  const placed = new Set<string>();
  return findings.map((finding) => {
    const calculate = CALCULATIONS[finding.clause_type];
    const exposure = calculate && !placed.has(finding.clause_type) ? calculate(figures) : null;
    if (calculate) placed.add(finding.clause_type);
    return {
      ...finding,
      exposure_amount: exposure?.amount ?? null,
      exposure_formula: exposure?.formula ?? null,
      exposure_basis: exposure?.basis ?? null,
    };
  });
}
