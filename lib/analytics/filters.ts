import { TIER_LABELS, type AnalyticsFilters, type ContractRecord, type ContractStatus, type MarketTier } from "./types";
import type { AnalyticsScope } from "./access";

type Params = Record<string, string | string[] | undefined>;

const FILTER_KEYS = ["from", "to", "brand", "parentCompany", "propertyId", "state", "city", "tier", "clientId", "associateId", "status"] as const;
const STATUSES: ContractStatus[] = ["signed", "negotiating", "lost"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from the URL. The associate filter is dropped for anyone who may not use it. */
export function parseFilters(params: Params, scope: AnalyticsScope): AnalyticsFilters {
  const one = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s?.trim() || undefined;
  };
  const filters: AnalyticsFilters = {};
  for (const key of FILTER_KEYS) {
    const value = one(key);
    if (!value) continue;
    if ((key === "from" || key === "to") && !DATE.test(value)) continue;
    if (key === "tier" && !(value in TIER_LABELS)) continue;
    if (key === "status" && !STATUSES.includes(value as ContractStatus)) continue;
    if (key === "associateId" && !scope.canFilterByAssociate) continue;
    (filters as Record<string, string>)[key] = value;
  }
  return filters;
}

/** Dates filter on the event's start date. */
export function applyFilters(records: ContractRecord[], f: AnalyticsFilters): ContractRecord[] {
  return records.filter(
    (r) =>
      (!f.from || r.eventStart >= f.from) &&
      (!f.to || r.eventStart <= f.to) &&
      (!f.brand || r.property.brand === f.brand) &&
      (!f.parentCompany || r.property.parentCompany === f.parentCompany) &&
      (!f.propertyId || r.property.id === f.propertyId) &&
      (!f.state || r.property.state === f.state) &&
      (!f.city || r.property.city === f.city) &&
      (!f.tier || r.property.tier === f.tier) &&
      (!f.clientId || r.client.id === f.clientId) &&
      (!f.associateId || r.associate.id === f.associateId) &&
      (!f.status || r.status === f.status)
  );
}

export interface Option {
  value: string;
  label: string;
}

export interface FilterOptions {
  brands: Option[];
  parentCompanies: Option[];
  properties: Option[];
  states: Option[];
  cities: Option[];
  tiers: Option[];
  clients: Option[];
  /** Empty for anyone who may not filter by associate. */
  associates: Option[];
}

const sortedOptions = (pairs: Iterable<[string, string]>): Option[] =>
  [...new Map(pairs).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));

/** The choices each filter offers, drawn from the records themselves. */
export function filterOptions(records: ContractRecord[], scope: AnalyticsScope): FilterOptions {
  const p = records.map((r) => r.property);
  return {
    brands: sortedOptions(p.map((x) => [x.brand, x.brand])),
    parentCompanies: sortedOptions(p.map((x) => [x.parentCompany, x.parentCompany])),
    properties: sortedOptions(p.map((x) => [x.id, `${x.name} (${x.city})`])),
    states: sortedOptions(p.filter((x) => x.state).map((x) => [x.state, x.state])),
    cities: sortedOptions(p.map((x) => [x.city, x.state ? `${x.city}, ${x.state}` : x.city])),
    tiers: sortedOptions(p.map((x) => [x.tier, TIER_LABELS[x.tier as MarketTier]])),
    clients: sortedOptions(records.map((r) => [r.client.id, r.client.name])),
    associates: scope.canFilterByAssociate ? sortedOptions(records.map((r) => [r.associate.id, r.associate.name])) : [],
  };
}

/** The URL for the same page with one filter changed. */
export function withFilter(base: string, filters: AnalyticsFilters, key: keyof AnalyticsFilters, value: string | undefined): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, [key]: value })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `${base}?${qs}` : base;
}
