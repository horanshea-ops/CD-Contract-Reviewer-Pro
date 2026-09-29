import { createAdminClient } from "../supabase/admin";
import { testDataset } from "./test-data";
import type { ContractRecord } from "./types";

/**
 * Where the Analytics tab's contracts come from.
 *
 * - "test": generated records (lib/analytics/test-data.ts). Only with
 *   ANALYTICS_SOURCE=test. A production build also needs ANALYTICS_DEMO=on.
 * - "database": signed contracts from reviews. Not built yet, so it has no
 *   records and the tab says so.
 */

export type SourceKind = "test" | "database";

export interface AnalyticsData {
  kind: SourceKind;
  contracts: ContractRecord[];
}

export function analyticsEnabled(): boolean {
  return process.env.ANALYTICS === "on";
}

/** Opens every original contract file to every associate. Term sheets are open to all regardless. */
export function sharesOriginals(): boolean {
  return process.env.ANALYTICS_SHARE_ORIGINALS === "on";
}

/** Test data in production only for a demonstration, with ANALYTICS_DEMO=on as well. */
export function sourceKind(): SourceKind {
  const allowed = process.env.NODE_ENV !== "production" || process.env.ANALYTICS_DEMO === "on";
  return process.env.ANALYTICS_SOURCE === "test" && allowed ? "test" : "database";
}

export async function loadAnalyticsData(): Promise<AnalyticsData> {
  if (sourceKind() === "test") {
    // Real associates get some test contracts, so each one sees rows of their own.
    const { data } = await createAdminClient().from("associates").select("id, name").eq("status", "active").order("created_at");
    return { kind: "test", contracts: testDataset(data ?? []).contracts };
  }
  return { kind: "database", contracts: [] };
}
