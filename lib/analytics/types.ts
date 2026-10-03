import type { TermValue } from "./terms";

export type MarketTier = "luxury" | "upper_upscale" | "upscale" | "resort" | "convention";

export const TIER_LABELS: Record<MarketTier, string> = {
  luxury: "Luxury",
  upper_upscale: "Upper upscale",
  upscale: "Upscale",
  resort: "Resort",
  convention: "Convention hotel",
};

export interface PropertyRecord {
  id: string;
  name: string;
  brand: string;
  parentCompany: string;
  address: string;
  city: string;
  /** State or province; empty outside countries that use one. */
  state: string;
  country: string;
  tier: MarketTier;
  /** Unknown for uploaded historical contracts. */
  guestRooms?: number;
}

export interface AssociateRef {
  id: string;
  name: string;
}

/** One term set, keyed by ANALYTICS_TERMS keys. A missing key means the contract doesn't state it. */
export type TermSnapshot = Record<string, TermValue>;

export type ContractStatus = "signed" | "negotiating" | "lost";

export interface ContractRecord {
  id: string;
  /** "test" records come from the generator. Production shows them only for a demonstration. */
  source: "test" | "review" | "historical";
  property: PropertyRecord;
  client: { id: string; name: string };
  associate: AssociateRef;
  eventName: string;
  eventStart: string;
  eventEnd: string;
  /** When the final version was signed; null while negotiating or after a loss. */
  signedAt: string | null;
  status: ContractStatus;
  /** The hotel's first draft. */
  firstDraft: TermSnapshot;
  /** What CD asked for in its redline. */
  requested: TermSnapshot;
  /** The signed version, or the latest version while negotiating. */
  final: TermSnapshot;
  /** The review this contract came from, when there is one. */
  analysisId: string | null;
  /** The historical upload this contract came from, when there is one. */
  historicalId?: string;
}

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  brand?: string;
  parentCompany?: string;
  propertyId?: string;
  state?: string;
  city?: string;
  tier?: MarketTier;
  clientId?: string;
  associateId?: string;
  status?: ContractStatus;
}
