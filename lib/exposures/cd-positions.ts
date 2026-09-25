/**
 * CD's positions, as the numbers the exposure calculations use.
 *
 * Each mirrors wording in the standards library (lib/standards/v1.ts). A test
 * checks that wording still states these figures, so an edit to the library
 * fails the build instead of leaving the calculations on old numbers.
 */

/** Attrition applies only below this share of the room block. */
export const ATTRITION_TRIGGER_OF_BLOCK = 0.7;

/** Attrition damages, as a share of the group rate. */
export const ATTRITION_DAMAGES_OF_RATE = 0.7;

/** Room profit, as a share of the group rate. Cancellation tiers apply to this. */
export const ROOM_PROFIT_OF_RATE = 0.7;

/** Share of a food and beverage shortfall the group pays. */
export const FB_SHORTFALL_RATE = 0.35;
