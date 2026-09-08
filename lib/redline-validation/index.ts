import { readPackage } from "./package";
import {
  checkContentTypes,
  checkPartsParse,
  checkPartsPreserved,
  checkRelationships,
  checkRevisionIds,
  checkRevisionMarks,
  checkTableStructure,
} from "./structure";
import { checkParagraphCount, checkRejectRoundTrip } from "./views";
import type { CheckResult, RedlineEngineResult, ValidationReport } from "./types";

export * from "./types";
export { readPackage } from "./package";

/**
 * The export validation oracle (MASTER_PLAN.md §1.6).
 *
 * Takes the document the property sent and the marked-up copy an engine
 * produced, and decides whether that copy is safe to hand an associate. It
 * knows nothing about how the copy was made, so it validates the legacy engine
 * today and §1.5's replacement unchanged.
 *
 * §1.6.3's LibreOffice deep check is dropped (CLAUDE.md, agreed deviations).
 * The reject round trip below is the real oracle.
 *
 * Never throws. Anything that goes wrong becomes a failed check, because an
 * oracle that crashes on a corrupt document tells you nothing about it.
 */
export async function validateRedline({
  originalBytes,
  engineResult,
  author,
}: {
  originalBytes: Uint8Array;
  engineResult: RedlineEngineResult;
  author: string;
}): Promise<ValidationReport> {
  const checks: CheckResult[] = [];

  const inputRead = await readPackage(originalBytes);
  const outputRead = await readPackage(engineResult.docxBytes);

  if (!outputRead.ok) {
    checks.push({ name: "archive_readable", passed: false, detail: outputRead.error });
    return report(checks, engineResult);
  }
  if (!inputRead.ok) {
    // The original is unreadable, so there is nothing to check the output
    // against. Refusing to guess is the point of the section.
    checks.push({
      name: "archive_readable",
      passed: false,
      detail: `The original document could not be re-read to check the markup against: ${inputRead.error}`,
    });
    return report(checks, engineResult);
  }

  const input = inputRead.pkg;
  const output = outputRead.pkg;
  checks.push({ name: "archive_readable", passed: true, detail: "The marked-up file is a readable Word archive." });

  const structural = [
    () => checkPartsParse(output),
    () => checkPartsPreserved(input, output),
    () => checkContentTypes(output),
    () => checkRelationships(output),
    () => checkRevisionIds(output),
    () => checkRevisionMarks(output),
    () => checkTableStructure(input, output),
  ];
  for (const run of structural) {
    try {
      checks.push(run());
    } catch (e) {
      checks.push({
        name: "parts_parse",
        passed: false,
        detail: `The document could not be checked: ${(e as Error).message}`,
      });
    }
  }

  const own = {
    ownIds: new Set(engineResult.ownRevisionIds),
    ownAuthor: author || null,
  };

  try {
    checks.push({ name: "paragraph_count_preserved", ...checkParagraphCount(input, output, own) });
  } catch (e) {
    checks.push({
      name: "paragraph_count_preserved",
      passed: false,
      detail: `The document could not be checked against the original: ${(e as Error).message}`,
    });
  }

  try {
    const trip = checkRejectRoundTrip(input, output, own);
    checks.push({ name: "reject_round_trip", passed: trip.passed, detail: trip.detail });
  } catch (e) {
    checks.push({
      name: "reject_round_trip",
      passed: false,
      detail: `The document could not be checked against the original: ${(e as Error).message}`,
    });
  }

  return report(checks, engineResult);
}

/** §1.6.4 — three outcomes, never all-or-nothing. */
function report(checks: CheckResult[], engineResult: RedlineEngineResult): ValidationReport {
  const firstFailure = checks.find((c) => !c.passed);
  const outcome = firstFailure ? "fallback" : engineResult.unapplied.length > 0 ? "partial" : "clean";
  return {
    outcome,
    checks,
    fallbackReason: firstFailure?.detail ?? null,
    unapplied: engineResult.unapplied,
    appliedCount: engineResult.appliedCount,
  };
}
