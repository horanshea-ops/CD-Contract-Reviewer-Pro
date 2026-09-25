import type { createAdminClient } from "./supabase/admin";

/**
 * How many reviews an associate may start each month.
 *
 * The firm caps uploads to control model spend. Every upload that creates an
 * analysis counts, including one that later fails, because a failed run may
 * already have cost money. A retry reruns an existing analysis and doesn't.
 *
 * Months are UTC calendar months, so the dashboard and the upload check always
 * count the same window.
 */

/** Provisional. The firm will set its own number. */
export const MONTHLY_REVIEW_LIMIT = 30;

export interface ReviewAllowance {
  limit: number;
  used: number;
  remaining: number;
  /** The month the count covers, e.g. "September". */
  month: string;
  /** When the count resets, e.g. "October 1". */
  resetsOn: string;
}

export function monthStartUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStartUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const monthName = (d: Date) => d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });

export function allowance(used: number, now: Date, limit = MONTHLY_REVIEW_LIMIT): ReviewAllowance {
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used),
    month: monthName(now),
    resetsOn: `${monthName(nextMonthStartUTC(now))} 1`,
  };
}

export function limitReachedMessage(a: ReviewAllowance): string {
  return `You've used all ${a.limit} reviews for ${a.month}. Uploads open again on ${a.resetsOn}.`;
}

export async function reviewAllowance(
  admin: ReturnType<typeof createAdminClient>,
  associateId: string,
  now = new Date()
): Promise<ReviewAllowance> {
  const { count, error } = await admin
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .eq("associate_id", associateId)
    .gte("created_at", monthStartUTC(now).toISOString());
  if (error) throw new Error(`Could not count this month's reviews: ${error.message}`);
  return allowance(count ?? 0, now);
}
