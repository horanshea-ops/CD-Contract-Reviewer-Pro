import type { NumericUnit } from "../quantities";
import type { LocatablePart } from "../redline-engine/locate";
import { normalizeValue, verify } from "../terms/validate";
import type { TermDefinition } from "../terms/types";

/**
 * The contract's own figures, as the exposure calculations need them.
 *
 * The model reads each figure and quotes the words it comes from. A figure is
 * kept only when its quote is in the contract and states that figure, the
 * same check the terms pass makes. An exposure built on anything else would
 * be a number the app can't trace back to the contract.
 */

/** Whether a cancellation tier charges a share of the full rate or of room profit. */
export type TierCharge = "rate" | "room_profit";

/** Which room nights a cancellation tier's percentage applies to. */
export type TierBase = "minimum_room_nights" | "room_block" | "other";

export interface CancellationTier {
  label: string;
  /** Fraction: 90% is 0.9. */
  room_pct: number;
  base: TierBase;
  charges: TierCharge;
}

export interface DealFigures {
  room_block_room_nights: number | null;
  group_rate_usd: number | null;
  minimum_room_nights: number | null;
  /** Fraction of the block. */
  attrition_threshold_pct: number | null;
  /** Fraction of the rate owed per short room night. */
  attrition_damages_pct: number | null;
  cancellation_tiers: CancellationTier[];
  fb_minimum_usd: number | null;
  /** Fraction of a shortfall owed. Null when the contract states none. */
  fb_shortfall_pct: number | null;
}

export const NO_FIGURES: DealFigures = {
  room_block_room_nights: null,
  group_rate_usd: null,
  minimum_room_nights: null,
  attrition_threshold_pct: null,
  attrition_damages_pct: null,
  cancellation_tiers: [],
  fb_minimum_usd: null,
  fb_shortfall_pct: null,
};

type ScalarKey = Exclude<keyof DealFigures, "cancellation_tiers">;

const UNITS: Record<ScalarKey, NumericUnit> = {
  room_block_room_nights: "rooms",
  group_rate_usd: "usd",
  minimum_room_nights: "rooms",
  attrition_threshold_pct: "pct",
  attrition_damages_pct: "pct",
  fb_minimum_usd: "usd",
  fb_shortfall_pct: "pct",
};

const definition = (key: string, unit: NumericUnit): TermDefinition => ({ key, kind: "number", unit, meaning: key });

/** A figure's value when its quote is in the contract and states it, else null. */
function checked(raw: unknown, key: string, unit: NumericUnit, parts: LocatablePart[]): number | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, quoted_text } = raw as { value?: unknown; quoted_text?: unknown };
  if (typeof quoted_text !== "string" || !quoted_text.trim()) return null;
  const def = definition(key, unit);
  const normalized = normalizeValue(def, value);
  if (!normalized.ok || typeof normalized.value !== "number") return null;
  return verify(def, normalized.value, quoted_text, null, parts) === "verified" ? normalized.value : null;
}

const BASES: readonly TierBase[] = ["minimum_room_nights", "room_block", "other"];
const CHARGES: readonly TierCharge[] = ["rate", "room_profit"];

function checkedTiers(raw: unknown, parts: LocatablePart[]): CancellationTier[] {
  if (!Array.isArray(raw)) return [];
  const tiers: CancellationTier[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { label, room_pct, base, charges, quoted_text } = item as Record<string, unknown>;
    if (typeof label !== "string" || !BASES.includes(base as TierBase) || !CHARGES.includes(charges as TierCharge)) continue;
    const pct = checked({ value: room_pct, quoted_text }, "cancellation.tier", "pct", parts);
    if (pct === null) continue;
    tiers.push({ label: label.trim(), room_pct: pct, base: base as TierBase, charges: charges as TierCharge });
  }
  return tiers;
}

export function checkFigures(raw: unknown, parts: LocatablePart[]): DealFigures {
  if (!raw || typeof raw !== "object") return NO_FIGURES;
  const input = raw as Record<string, unknown>;
  const figures: DealFigures = { ...NO_FIGURES, cancellation_tiers: checkedTiers(input.cancellation_tiers, parts) };
  for (const key of Object.keys(UNITS) as ScalarKey[]) {
    figures[key] = checked(input[key], key, UNITS[key], parts);
  }
  return figures;
}
