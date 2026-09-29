import { createAdminClient } from "../supabase/admin";
import { historicalRecords, type StoredTerm } from "./historical";
import { testDataset } from "./test-data";
import type { HistoricalContract } from "../historical/types";
import type { ContractRecord } from "./types";

/**
 * Where the Analytics tab's contracts come from.
 *
 * - "test": generated records (lib/analytics/test-data.ts). Only with
 *   ANALYTICS_SOURCE=test. A production build also needs ANALYTICS_DEMO=on.
 * - "database": historical contracts an admin uploaded. Signed contracts
 *   from reviews join them later.
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
  const db = createAdminClient();
  const [{ data: contracts }, { data: associates }] = await Promise.all([
    db.from("historical_contracts").select("*"),
    db.from("associates").select("id, name"),
  ]);
  const ids = (contracts ?? []).map((c) => c.id);
  const { data: terms } = ids.length
    ? await db
        .from("contract_terms")
        .select("historical_contract_id, term_key, status, term_value, verification")
        .in("historical_contract_id", ids)
    : { data: [] };

  return {
    kind: "database",
    contracts: historicalRecords(
      (contracts ?? []) as HistoricalContract[],
      (terms ?? []) as StoredTerm[],
      new Map((associates ?? []).map((a) => [a.id, a.name]))
    ),
  };
}
