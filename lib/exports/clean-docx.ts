import { logAudit } from "../audit";
import { acceptOwnRevisions } from "../docx-accept";
import { recordExport } from "../export-log";
import { readPackage } from "../redline-validation";
import { allRevisions } from "../redline-validation/package";
import {
  checkContentTypes,
  checkPartsParse,
  checkPartsPreserved,
  checkRelationships,
} from "../redline-validation/structure";
import { currentText } from "../redline-validation/views";
import { cachedBuild, fingerprint } from "./build-cache";
import type { ExportContext } from "./context";
import { hasEditableWordFile, loadRedline } from "./redline";
import type { ExportBuildResult, ExportRefusalResult } from "./types";

const DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The proposed contract as a Word file: the tracked-changes DOCX with this
 * export's changes accepted, so it keeps the property's exact formatting.
 *
 * Checked before delivery. It must open as a Word archive, keep every part,
 * carry none of our revision marks, and read exactly as the redline does with
 * every change accepted.
 */
export async function buildCleanDocx(ctx: ExportContext): Promise<ExportBuildResult> {
  const { admin, associate, analysis, analysisId } = ctx;

  if (!hasEditableWordFile(analysis)) {
    return refusal(
      400,
      { error: "A clean Word copy is only available for contracts uploaded as Word files that can be edited." },
      "The proposed contract (Word) was not exported. There is no editable Word file for this contract."
    );
  }

  const loaded = await loadRedline(ctx);
  if (!loaded.ok) {
    return { ...loaded.refusal, summary: "The proposed contract (Word) was not exported. The tracked changes could not be generated." };
  }
  const { engineResult, report, findings, nonSubstantive } = loaded.redline;

  if (!findings.some((f) => f.language.trim())) {
    return refusal(
      400,
      { error: "No accepted changes, so this would just be the original contract." },
      "The proposed contract (Word) was not exported. There are no accepted changes."
    );
  }
  if (report.outcome === "fallback") {
    return refusal(
      409,
      { error: "The tracked-changes file did not pass validation, so no Word copy can be built from it." },
      "The proposed contract (Word) was not exported. The tracked-changes file did not pass validation."
    );
  }

  const built = await cachedBuild(
    `${associate.id}:${analysisId}:clean-docx`,
    fingerprint([analysis.original_storage_path, associate.name, findings]),
    async () => {
      const own = new Set(engineResult.ownRevisionIds);
      const bytes = await acceptOwnRevisions(engineResult.docxBytes, own);
      return { bytes, problems: await check(engineResult.docxBytes, bytes, own) };
    }
  );

  if (built.problems.length) {
    return refusal(
      409,
      { error: "The clean Word copy failed its check and was not produced.", problems: built.problems },
      "The proposed contract (Word) was not exported. It failed its check and was discarded."
    );
  }

  const outcome = report.unapplied.length ? "partial" : "clean";
  return {
    kind: "file",
    filename: analysis.filename.replace(/\.docx$/i, "") + "-proposed.docx",
    contentType: DOCX_CONTENT_TYPE,
    bytes: built.bytes.slice(),
    outcome,
    preflight: null,
    commit: async () => {
      await recordExport(admin, {
        analysisId,
        associateId: associate.id,
        format: "docx",
        outcome,
        findingsApplied: report.appliedCount,
        findingsUnapplied: report.unapplied.length,
        unappliedDetail: report.unapplied.length ? report.unapplied : null,
        analysisPaths: analysis,
      });
      await logAudit({
        actorId: associate.id,
        action: "clean_docx_exported",
        entityType: "analysis",
        entityId: analysisId,
        metadata: {
          applied: report.appliedCount,
          unapplied: report.unapplied.length,
          non_substantive: nonSubstantive.length,
          outcome,
        },
      });
    },
  };
}

async function check(redlineBytes: Uint8Array, cleanBytes: Uint8Array, own: Set<string>): Promise<string[]> {
  const redline = await readPackage(redlineBytes);
  const clean = await readPackage(cleanBytes);
  if (!redline.ok) return [redline.error];
  if (!clean.ok) return [clean.error];

  const problems = [
    checkPartsParse(clean.pkg),
    checkPartsPreserved(redline.pkg, clean.pkg),
    checkContentTypes(clean.pkg),
    checkRelationships(clean.pkg),
  ]
    .filter((c) => !c.passed)
    .map((c) => c.detail);

  const left = allRevisions(clean.pkg).filter((r) => own.has(r.id));
  if (left.length) problems.push(`${left.length} of this export's tracked changes are still in the file.`);

  const alnum = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  if (alnum(currentText(redline.pkg)) !== alnum(currentText(clean.pkg))) {
    problems.push("The clean copy does not read the same as the tracked-changes file with every change accepted.");
  }
  return problems;
}

function refusal(status: number, body: ExportRefusalResult["body"], summary: string): ExportRefusalResult {
  return { kind: "refusal", status, body, preflight: null, summary };
}
