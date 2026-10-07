/**
 * Exposure math is archived for the beta (docs/archived-features.md). Its
 * figures varied between runs on one contract, so the associate works out the
 * dollar risk. EXPOSURES=on brings the figures back.
 */
export function exposuresEnabled(): boolean {
  return process.env.EXPOSURES === "on";
}

interface WithExposure {
  exposure_amount: number | null;
  exposure_basis: string | null;
  exposure_formula?: string | null;
}

/**
 * A finding as it may be shown. A review run before the archive still has its
 * figures stored, and they stay out of the screen and the client email while
 * the switch is off. The stored row is never changed.
 */
export function withoutArchivedExposure<T extends WithExposure>(finding: T): T {
  if (exposuresEnabled()) return finding;
  return { ...finding, exposure_amount: null, exposure_basis: null, exposure_formula: null };
}
