/**
 * Explains, to the associate only, why a document is getting a PDF markup
 * instead of a Word tracked-changes file. Shown in the app before download
 * (a confirmation dialog, a banner) — never written into the exported PDF
 * itself, which carries the changes and nothing about CD's tooling.
 *
 * Only called when the forced-downgrade condition already holds:
 * `source_format !== "pdf" && intake_route !== "docx_native"`. A genuine
 * PDF upload or a healthy .docx never reaches this function.
 */

const DOC_REASON =
  "This file is a legacy .doc, a format that predates the structure tracked changes need, so it can't be edited directly.";

export function getMarkupReason({
  sourceFormat,
  intakeHealthReason,
}: {
  sourceFormat: "docx" | "doc" | "pdf";
  intakeHealthReason: string | null;
}): string {
  if (sourceFormat === "doc") return DOC_REASON;
  return (
    intakeHealthReason ??
    "This document could not be read cleanly enough to edit directly, so it can't be marked up as tracked changes."
  );
}
