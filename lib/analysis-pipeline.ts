import { createAdminClient } from "./supabase/admin";
import { analyzeContract, type AnalyzableDocument } from "./anthropic";
import { extractDocx } from "./docx";
import { loadStandardsLibrary } from "./standards/load";
import { logAudit } from "./audit";
import { getPositionedLines } from "./get-positioned-lines";
import { findMatchingLineIndices } from "./locate-text";
import { scanForAiUseTerms, scanForAdjacentTerms } from "./ai-use-scan";

const STORAGE_BUCKET = "contracts";

/**
 * Runs the actual analysis for one row in `analyses`, from "queued" through
 * "complete" or "failed". Called from the upload route via Next's after()
 * so the client gets its 202 response immediately and polls for status
 * (build brief §5) rather than holding a request open for 30-90+ seconds.
 */
export async function processAnalysis(analysisId: string) {
  const admin = createAdminClient();

  const { data: analysis, error: fetchError } = await admin
    .from("analyses")
    .select("id, storage_path, associate_id, source_format, intake_route, original_storage_path, ai_clause_acknowledged_at")
    .eq("id", analysisId)
    .single();

  if (fetchError || !analysis) {
    console.error(`processAnalysis: could not load analysis ${analysisId}`, fetchError);
    return;
  }

  await admin
    .from("analyses")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", analysisId);

  try {
    const { data: fileBlob, error: downloadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .download(analysis.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(`Could not read uploaded file: ${downloadError?.message ?? "unknown error"}`);
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

    // The database is the source of truth for the library, so admin edits
    // actually change how contracts are reviewed. A fallback to the bundled
    // copy is allowed (a transient database problem should not fail an
    // analysis) but is always recorded, never silent.
    const standards = await loadStandardsLibrary();
    if (standards.source === "bundled_fallback") {
      console.warn(
        `processAnalysis: ${analysisId} used the bundled standards library, not the database — ${standards.fallbackReason}`
      );
    }

    // What the model reads. A DOCX that passed the intake health gate is
    // re-extracted here rather than analysed as a converted PDF, so tables
    // arrive as tables — the accuracy problem §1.4.5 describes, where
    // cancellation schedules and attrition scales reach the model flattened
    // into prose. Extraction is re-run rather than cached: §1.1 forbids
    // persisting the map, since a stale one against a re-uploaded file places
    // edits in the wrong part of the document.
    let document: AnalyzableDocument = { kind: "pdf", pdfBase64 };
    let scanText: string | null = null;
    if (analysis.intake_route === "docx_native" && analysis.original_storage_path) {
      try {
        const { data: originalBlob, error: originalErr } = await admin.storage
          .from(STORAGE_BUCKET)
          .download(analysis.original_storage_path);
        if (originalErr || !originalBlob) throw new Error(originalErr?.message ?? "original file unavailable");
        const extracted = await extractDocx(new Uint8Array(await originalBlob.arrayBuffer()));
        scanText = contractText(extracted);
        document = { kind: "text", text: scanText };
      } catch (extractErr) {
        // Falling back to the PDF loses table structure but still produces an
        // analysis, which beats failing the run outright. Recorded, not silent.
        console.warn(
          `processAnalysis: ${analysisId} could not extract the original DOCX, analysing the converted PDF instead —`,
          extractErr
        );
      }
    }

    // §1.10.1 — local text to scan before any network call. docx_native
    // already has it above (the exact text the model will read). Every other
    // route — genuine PDF, .doc, or a .docx that failed intake and fell back
    // to the PDF just above — gets it from the same positioned-line data the
    // markup-PDF export already relies on (lib/get-positioned-lines.ts),
    // which is local (unpdf's own PDF parsing) either way, not a network call.
    if (scanText === null) {
      const lines = await getPositionedLines({
        admin,
        associateId: analysis.associate_id,
        analysisId,
        sourceFormat: analysis.source_format,
        pdfBytes: new Uint8Array(arrayBuffer),
      });
      scanText = lines.map((l) => l.text).join("\n");
    }

    // §1.10 — the AI-use provision pre-check. Skipped only when an associate
    // has already ruled on this analysis (a resumed run after "proceed"):
    // the compliance record was written by that decision, not by re-scanning.
    if (!analysis.ai_clause_acknowledged_at) {
      const aiMatches = scanForAiUseTerms(scanText);
      const adjacentMatches = scanForAdjacentTerms(scanText);

      await admin
        .from("analyses")
        .update({
          ai_clause_scan_result: {
            scanned_at: new Date().toISOString(),
            matches: aiMatches,
            adjacent_matches: adjacentMatches,
            decision: null,
          },
        })
        .eq("id", analysisId);

      if (aiMatches.length > 0) {
        await logAudit({
          actorId: analysis.associate_id,
          action: "ai_clause_scan_blocked",
          entityType: "analysis",
          entityId: analysisId,
          metadata: { matched_terms: aiMatches.map((m) => m.term) },
        });
        // Gated, not failed and not complete. Status stays "processing" until
        // an associate decides via app/api/analyses/[id]/ai-clause-decision —
        // "proceed" re-invokes processAnalysis, which lands back here and
        // takes this branch's else path since ai_clause_acknowledged_at is
        // now set.
        return;
      }
    }

    const result = await analyzeContract({
      document,
      standards: standards.entries,
      standardsVersion: standards.version,
    });

    if (result.findings.length > 0) {
      const findingRows = result.findings.map((f) => ({
        analysis_id: analysisId,
        clause_type: f.clause_type,
        is_missing_clause: f.is_missing_clause,
        severity: f.severity,
        exposure_amount: f.exposure_amount,
        exposure_basis: f.exposure_basis,
        location_section: f.location_section,
        quoted_text: f.quoted_text,
        finding_text: f.finding_text,
        cd_standard: f.cd_standard,
        proposed_language: f.proposed_language,
        model_confidence: f.model_confidence,
      }));

      const { data: insertedFindings, error: insertError } = await admin
        .from("findings")
        .insert(findingRows)
        .select("id, is_missing_clause, quoted_text");
      if (insertError) throw new Error(`Could not save findings: ${insertError.message}`);

      // Best-effort: precompute which findings can be located on the
      // rendered document, so the review screen can show that immediately
      // instead of only discovering it lazily at export time. A failure
      // here is a missed enhancement, not a failed analysis — it must never
      // flip an otherwise-successful analysis to "failed".
      try {
        const lines = await getPositionedLines({
          admin,
          associateId: analysis.associate_id,
          analysisId,
          sourceFormat: analysis.source_format,
          pdfBytes: new Uint8Array(arrayBuffer),
        });

        for (const finding of insertedFindings ?? []) {
          if (finding.is_missing_clause || !finding.quoted_text) continue;
          const matchedIndices = findMatchingLineIndices(lines, finding.quoted_text);
          if (!matchedIndices) continue;
          await admin
            .from("findings")
            .update({ location_page: lines[matchedIndices[0]].pageIndex + 1 })
            .eq("id", finding.id);
        }
      } catch (locateErr) {
        console.error(`processAnalysis: could not precompute finding locations for ${analysisId}`, locateErr);
      }
    }

    // Checked, unlike the status updates above: if this write fails the row
    // stays "processing" forever and the review screen polls an analysis that
    // silently never arrives — after the model call has already been paid for.
    // A pending migration is the likeliest cause, so surface it as a failure
    // the associate can see rather than a hang.
    const { error: completeError } = await admin
      .from("analyses")
      .update({
        status: "complete",
        completed_at: new Date().toISOString(),
        model_id: result.model_id,
        library_version: result.standards_library_version,
        standards_source: standards.source,
        standards_hash: standards.hash,
        token_usage: {
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
          cache_read_input_tokens: result.cache_read_input_tokens,
          cache_creation_input_tokens: result.cache_creation_input_tokens,
        },
      })
      .eq("id", analysisId);

    if (completeError) {
      throw new Error(
        `Analysis succeeded but could not be saved: ${completeError.message}. ` +
          `If this mentions an unknown column, a migration in supabase/migrations/ has not been applied.`
      );
    }

    await logAudit({
      actorId: analysis.associate_id,
      action: "analysis_complete",
      entityType: "analysis",
      entityId: analysisId,
      metadata: {
        findings_count: result.findings.length,
        clauses_checked: result.clauses_checked,
        standards_source: standards.source,
        standards_hash: standards.hash,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await admin
      .from("analyses")
      .update({ status: "failed", completed_at: new Date().toISOString(), error: message })
      .eq("id", analysisId);

    await logAudit({
      actorId: analysis.associate_id,
      action: "analysis_failed",
      entityType: "analysis",
      entityId: analysisId,
      metadata: { error: message },
    });
  }
}

/**
 * Flattens the extracted parts into the single block of text the model reads.
 * Headers and footers are labelled rather than silently concatenated, because a
 * cutoff date in a header is a real contract term and the associate needs to
 * know where a finding came from.
 */
function contractText(extracted: Awaited<ReturnType<typeof extractDocx>>): string {
  return extracted.parts
    .map((part) =>
      part.part === "document"
        ? part.text
        : `\n\n[${part.part.toUpperCase()} — these terms form part of the agreement]\n${part.text}`
    )
    .join("")
    .trim();
}
