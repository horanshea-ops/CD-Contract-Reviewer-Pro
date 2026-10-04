import { createHash, randomUUID } from "crypto";
import { buildSystemPrompt, findingsToolSchema, reviewContent, type AnalyzeContractPdfArgs } from "./anthropic";
import type { createAdminClient } from "./supabase/admin";

/**
 * Re-using a review when the same file is uploaded again.
 *
 * A review is copied only when the model would be asked the same question
 * about the same content. Three hashes say so: what the call would send as
 * the contract, the model with its instructions and answer form, and the
 * standards library. A change to any of them means the old findings may no
 * longer be what the tool would say, so the upload gets a full review.
 */

type Admin = ReturnType<typeof createAdminClient>;

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Everything the review call would send as the contract: its text or file, its pictures, its comments and any note on them. */
export function contentHash(sent: Pick<AnalyzeContractPdfArgs, "document" | "comments" | "commentsTotal" | "contextNote">): string {
  return sha256(reviewContent(sent));
}

/** The model, its instructions and its answer form. The library is left out, since `standards_hash` covers it. */
export function promptHash(modelId: string): string {
  return sha256({ model: modelId, system: buildSystemPrompt([], ""), tool: findingsToolSchema() });
}

export interface ReviewKey {
  associateId: string;
  contentHash: string;
  promptHash: string;
  standardsHash: string;
}

export interface EarlierReview {
  id: string;
  completed_at: string | null;
}

/**
 * The associate's latest full review that matches the key. A copy is never a
 * source, so a copy of a copy still points at the review the model wrote.
 *
 * Any error reads as no match. The likeliest cause is migration 015 not being
 * applied, and an upload must fall back to a full review, not fail.
 */
export async function findReusableReview(admin: Admin, key: ReviewKey, excludeId: string): Promise<EarlierReview | null> {
  try {
    const { data, error } = await admin
      .from("analyses")
      .select("id, completed_at")
      .eq("associate_id", key.associateId)
      .eq("content_hash", key.contentHash)
      .eq("prompt_hash", key.promptHash)
      .eq("standards_hash", key.standardsHash)
      .eq("status", "complete")
      .eq("review_kind", "full")
      .neq("id", excludeId)
      .order("completed_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return (data?.[0] as EarlierReview | undefined) ?? null;
  } catch (err) {
    console.warn("findReusableReview: could not look for an earlier review, so this upload gets a full one —", err);
    return null;
  }
}

/**
 * Copies a review's findings, and every decision the associate made on them,
 * onto another analysis. Returns what the completed row should carry over.
 *
 * Decisions keep their original times, so the latest one on each finding is
 * still the latest.
 */
export async function copyReview(admin: Admin, sourceId: string, targetId: string) {
  const { data: source, error: sourceError } = await admin
    .from("analyses")
    .select("model_id, library_version, standards_source, standards_hash, document_notes, term_extraction")
    .eq("id", sourceId)
    .single();
  if (sourceError || !source) throw new Error(`Could not read the earlier review: ${sourceError?.message ?? "not found"}`);

  const { data: findings, error: findingsError } = await admin.from("findings").select("*").eq("analysis_id", sourceId);
  if (findingsError) throw new Error(`Could not read the earlier review's findings: ${findingsError.message}`);

  const newIdOf = new Map<string, string>();
  const copies = (findings ?? []).map((finding: Record<string, unknown>) => {
    const { id, created_at, ...rest } = finding;
    void created_at;
    const newId = randomUUID();
    newIdOf.set(id as string, newId);
    return { ...rest, id: newId, analysis_id: targetId };
  });

  if (copies.length > 0) {
    const { error } = await admin.from("findings").insert(copies);
    if (error) throw new Error(`Could not copy the findings: ${error.message}`);
  }

  let decisions = 0;
  if (newIdOf.size > 0) {
    const { data: actions, error: actionsError } = await admin
      .from("finding_actions")
      .select("*")
      .in("finding_id", [...newIdOf.keys()])
      .order("created_at", { ascending: true });
    if (actionsError) throw new Error(`Could not read the earlier decisions: ${actionsError.message}`);

    const actionCopies = (actions ?? []).map((action: Record<string, unknown>) => {
      const { id, ...rest } = action;
      void id;
      return { ...rest, finding_id: newIdOf.get(action.finding_id as string) };
    });
    if (actionCopies.length > 0) {
      const { error } = await admin.from("finding_actions").insert(actionCopies);
      if (error) throw new Error(`Could not copy the earlier decisions: ${error.message}`);
    }
    decisions = actionCopies.length;
  }

  // Stored terms go with the review they were read for. Best-effort, as storing them is.
  const { data: terms } = await admin.from("contract_terms").select("*").eq("analysis_id", sourceId);
  if (terms && terms.length > 0) {
    const termCopies = terms.map((term: Record<string, unknown>) => {
      const { id, ...rest } = term;
      void id;
      return { ...rest, analysis_id: targetId };
    });
    const { error } = await admin.from("contract_terms").insert(termCopies);
    if (error) console.warn(`copyReview: the stored terms were not copied — ${error.message}`);
  }

  return { source: source as Record<string, unknown>, findings: copies.length, decisions };
}
