import type { StandardEntry } from "../standards/types";

/**
 * CD's positions, as the numbers the exposure calculations and the must-raise
 * checks use.
 *
 * Each is read from the wording of its standard in the library, which is what
 * CD edits on the Standards screen. A change to the number there reaches the
 * next review with no change to code.
 *
 * The app finds each number by the words around it. When a standard's wording
 * no longer states the number where the app looks, the built-in value stands
 * in and the number is reported as unread. The Standards screen and each
 * review's record show that, so a fallback is never silent.
 */

export interface CdPositions {
  /** Attrition applies only below this share of the room block. */
  attritionTrigger: number;
  /** Room profit, as a share of the group rate. Cancellation tiers apply to this. */
  roomProfit: number;
  /** Share of a food and beverage shortfall the group pays. */
  fbShortfall: number;
  /** Commission the hotel pays on room revenue. */
  commission: number;
}

export type PositionKey = keyof CdPositions;

/** Stands in only when a standard's wording can't be read. */
export const DEFAULT_POSITIONS: CdPositions = { attritionTrigger: 0.7, roomProfit: 0.7, fbShortfall: 0.35, commission: 0.1 };

export interface PositionSource {
  key: PositionKey;
  /** The standard whose position states the number. */
  clause_type: string;
  /** What the number is, for the Standards screen. */
  label: string;
  /** The words the number sits in. The first group is the percentage. */
  pattern: RegExp;
  /** Wording the app can read, shown to an admin whose edit it couldn't. */
  example: string;
}

export const POSITION_SOURCES: readonly PositionSource[] = [
  {
    key: "attritionTrigger",
    clause_type: "attrition",
    label: "attrition floor, as a share of the room block",
    pattern: /below\s+(\d+(?:\.\d+)?)\s*%\s+of\s+the\s+(?:room\s+)?block/i,
    example: "below 70% of the block",
  },
  {
    key: "roomProfit",
    clause_type: "cancellation",
    label: "room profit, as a share of the group rate",
    pattern: /(\d+(?:\.\d+)?)\s*%\s+of\s+the\s+(?:single\s+)?net\s+group\s+rate/i,
    example: "70% of the single net group rate",
  },
  {
    key: "fbShortfall",
    clause_type: "fb_minimum",
    label: "share of a food and beverage shortfall the group pays",
    pattern: /(\d+(?:\.\d+)?)\s*%\s+of\s+(?:the|a|any)\s+shortfall/i,
    example: "35% of the shortfall",
  },
  {
    key: "commission",
    clause_type: "commission",
    label: "commission on room revenue",
    pattern: /(\d+(?:\.\d+)?)\s*%\s+commission/i,
    example: "10% commission",
  },
];

/** The number a standard's wording states, as a fraction, or null when it isn't there. */
export function readPosition(source: PositionSource, position: string): number | null {
  const percent = Number(source.pattern.exec(position)?.[1]);
  return Number.isFinite(percent) && percent > 0 && percent <= 100 ? Number((percent / 100).toFixed(10)) : null;
}

export interface PositionsRead {
  positions: CdPositions;
  /** Numbers the library's wording didn't give, for which the built-in value is standing in. */
  unread: PositionKey[];
}

export function positionsFrom(standards: Pick<StandardEntry, "clause_type" | "position">[]): PositionsRead {
  const positions = { ...DEFAULT_POSITIONS };
  const unread: PositionKey[] = [];

  for (const source of POSITION_SOURCES) {
    const standard = standards.find((s) => s.clause_type === source.clause_type);
    const value = standard ? readPosition(source, standard.position) : null;
    if (value === null) unread.push(source.key);
    else positions[source.key] = value;
  }
  return { positions, unread };
}
