export function titleCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/** Whole dollars with commas. Exposure figures are estimates, so cents would claim precision they don't have. */
export function formatCurrency(amount: number, symbol = "$"): string {
  return `${symbol}${Math.round(amount).toLocaleString("en-US")}`;
}

/** Names a clause type can't spell out from its stored key. */
const CLAUSE_LABELS: Record<string, string> = {
  fb_minimum: "F&B Minimum",
  ada_compliance: "ADA Compliance",
  av_internet: "AV & Internet",
  rebates: "Comp Rooms & Rebates",
  review_audit_dates: "Block Reviews & Audit",
  exclusivity_vendors: "Exclusive Vendors",
  walk_relocation: "Walk & Relocation",
  insurance_indemnification: "Insurance & Indemnification",
  governing_law_venue: "Governing Law & Venue",
  gratuity_service_charge: "Gratuity & Service Charge",
  assignment_subcontracting: "Assignment & Subcontracting",
  brand_ownership_change: "Brand or Ownership Change",
  construction_renovation: "Construction & Renovation",
  facilities_services: "Facilities & Services",
  damage_deposit: "Damage Deposit",
  general: "Outside CD standards",
};

/** A clause type as a reader sees it: "fb_minimum" becomes "F&B Minimum". */
export function clauseLabel(clauseType: string): string {
  return CLAUSE_LABELS[clauseType] ?? titleCase(clauseType);
}
