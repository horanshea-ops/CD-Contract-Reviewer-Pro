import { createAdminClient } from "../supabase/admin";
import { TEST_AS_OF, testDataset } from "./test-data";
import type { ContractRecord } from "./types";

/**
 * Where the Analytics tab's contracts come from.
 *
 * - "test": generated records (lib/analytics/test-data.ts). Only with
 *   ANALYTICS_SOURCE=test, and never in a production build.
 * - "database": signed contracts from reviews. Not built yet, so it has no
 *   records and the tab says so.
 */

export type SourceKind = "test" | "database";

export interface AnalyticsData {
  kind: SourceKind;
  contracts: ContractRecord[];
  /** The date "open" and "upcoming" are measured from. Fixed for test data. */
  asOf: string;
}

export function analyticsEnabled(): boolean {
  return process.env.ANALYTICS === "on";
}

/** Opens every original contract file to every associate. Term sheets are open to all regardless. */
export function sharesOriginals(): boolean {
  return process.env.ANALYTICS_SHARE_ORIGINALS === "on";
}

export function sourceKind(): SourceKind {
  return process.env.ANALYTICS_SOURCE === "test" && process.env.NODE_ENV !== "production" ? "test" : "database";
}

export async function loadAnalyticsData(): Promise<AnalyticsData> {
  if (sourceKind() === "test") {
    // Real associates get some test contracts, so each one sees rows of their own.
    const { data } = await createAdminClient().from("associates").select("id, name").eq("status", "active").order("created_at");
    return { kind: "test", contracts: testDataset(data ?? []).contracts, asOf: TEST_AS_OF };
  }
  return { kind: "database", contracts: [], asOf: new Date().toISOString().slice(0, 10) };
}
