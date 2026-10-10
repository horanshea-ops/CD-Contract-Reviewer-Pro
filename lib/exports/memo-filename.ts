/**
 * The memo's file name. It opens with "internal" because the memo carries
 * CD's rationale and must not reach the property.
 */
export function memoFilename(analysisId: string): string {
  return `internal-requested-revisions-${analysisId.slice(0, 8)}.pdf`;
}
