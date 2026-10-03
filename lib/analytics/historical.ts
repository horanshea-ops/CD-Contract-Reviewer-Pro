import { needsALook } from "../historical/details";
import type { HistoricalContract } from "../historical/types";
import { termByKey, type TermValue } from "./terms";
import type { ContractRecord, TermSnapshot } from "./types";

/** A stored term, as far as the mapping needs it. */
export interface StoredTerm {
  historical_contract_id: string;
  term_key: string;
  status: "stated" | "not_stated";
  term_value: unknown;
  verification: string | null;
}

/** Only terms checked against the contract's own words count. */
const TRUSTED = new Set(["verified", "located"]);

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Stored percentages are fractions (0.8); Analytics works in points (80). */
function valueFor(key: string, raw: unknown): TermValue | undefined {
  const term = termByKey(key);
  if (!term) return undefined;
  if (term.kind === "boolean") return typeof raw === "boolean" ? raw : undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return term.unit === "pct" ? Number((raw * 100).toFixed(6)) : raw;
}

/**
 * Historical uploads as Analytics records. An upload counts once it has a
 * hotel, city, signed date and tier; one naming no brand counts as independent.
 * A term the contract doesn't state, or that failed its check, stays missing.
 * Uploads have no draft history, so the first draft and CD's asks are empty,
 * and the charts about asks leave them out.
 */
export function historicalRecords(
  contracts: HistoricalContract[],
  terms: StoredTerm[],
  associateNames: Map<string, string>
): ContractRecord[] {
  const byContract = new Map<string, TermSnapshot>();
  for (const t of terms) {
    if (t.status !== "stated" || !t.verification || !TRUSTED.has(t.verification)) continue;
    const value = valueFor(t.term_key, t.term_value);
    if (value === undefined) continue;
    const snapshot = byContract.get(t.historical_contract_id) ?? {};
    snapshot[t.term_key] = value;
    byContract.set(t.historical_contract_id, snapshot);
  }

  return contracts
    .filter((c) => !needsALook(c))
    .map((c): ContractRecord => {
      const hotel = c.hotel_name!;
      const city = c.city!;
      const client = c.client_name ?? "Client not recorded";
      const brand = c.brand ?? "Independent";
      const eventStart = c.event_start ?? c.signed_at!;
      return {
        id: c.id,
        source: "historical",
        property: {
          id: `h-${slug(hotel)}-${slug(city)}`,
          name: hotel,
          brand,
          parentCompany: c.parent_company ?? brand,
          address: "",
          city,
          state: c.state ?? "",
          country: c.country ?? "",
          tier: c.market_tier!,
        },
        client: { id: `hc-${slug(client)}`, name: client },
        associate: c.negotiated_by
          ? { id: c.negotiated_by, name: associateNames.get(c.negotiated_by) ?? "Former associate" }
          : { id: "not-recorded", name: "Not recorded" },
        eventName: `${client} at ${hotel}`,
        eventStart,
        eventEnd: c.event_end ?? eventStart,
        signedAt: c.signed_at!,
        status: "signed",
        firstDraft: {},
        requested: {},
        final: byContract.get(c.id) ?? {},
        analysisId: null,
        historicalId: c.id,
      };
    })
    .sort((a, b) => b.eventStart.localeCompare(a.eventStart));
}
