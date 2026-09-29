import type { ContractRecord } from "./types";

/**
 * Who sees what in the Analytics tab.
 *
 * The tab is a firm-wide library. Every associate sees every contract's terms
 * and can open its term sheet, so each negotiation starts from everything CD
 * has signed. Only admins see which associate negotiated a contract, except
 * that an associate always sees their own.
 *
 * The original contract file carries names and signatures, so it follows the
 * review access rule: its associate and admins. ANALYTICS_SHARE_ORIGINALS=on
 * opens originals to everyone.
 */

export interface AnalyticsScope {
  associateId: string;
  isAdmin: boolean;
  canFilterByAssociate: boolean;
  showsAssociate: (record: ContractRecord) => boolean;
  canOpenOriginal: (record: ContractRecord) => boolean;
}

export function scopeFor(associate: { id: string; is_admin: boolean }, shareOriginals: boolean): AnalyticsScope {
  const own = (record: ContractRecord) => record.associate.id === associate.id;
  return {
    associateId: associate.id,
    isAdmin: associate.is_admin,
    canFilterByAssociate: associate.is_admin,
    showsAssociate: (record) => associate.is_admin || own(record),
    canOpenOriginal: (record) => associate.is_admin || shareOriginals || own(record),
  };
}
