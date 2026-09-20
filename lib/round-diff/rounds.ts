import { extractDocx } from "../docx";
import { getPositionedLines } from "../get-positioned-lines";
import { getActionedFindings } from "../get-actioned-findings";
import { generateRedline } from "../redline-engine";
import type { createAdminClient } from "../supabase/admin";
import { compareVersions, joinParts, type ComparedVersions, type VersionInput } from "./compare";

const STORAGE_BUCKET = "contracts";

/**
 * Loading the two versions a round diff compares (MASTER_PLAN.md §2.1.1).
 *
 * The comparison itself is pure and lives in ./compare.ts. This is the half
 * that knows about the database and about storage, and its real work is
 * choosing a baseline: what did we actually send the property last round?
 *
 * There is a ladder of answers, and which rung the diff stood on is reported
 * with it. A reconstruction is a reasonable guess, not the file that was sent,
 * and presenting the two as the same thing is how a diff quietly blames a
 * property for an edit of ours.
 */

export type BaselineSource =
  /** The tracked-changes file we sent, kept at export time (§1.9.4). */
  | "sent_export"
  /** Rebuilt from the original plus the decisions on record. */
  | "rebuilt_export"
  /** The property's own draft from that round, with no changes of ours in it. */
  | "received_docx"
  /** The accepted-view text stored with the round. */
  | "stored_text"
  /** Text recovered from the stored PDF. */
  | "pdf_text";

export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_OF: Record<BaselineSource, Confidence> = {
  sent_export: "high",
  rebuilt_export: "medium",
  received_docx: "medium",
  stored_text: "low",
  pdf_text: "low",
};

/** What each baseline means, in the words the associate should read. */
export const BASELINE_EXPLANATION: Record<BaselineSource, string> = {
  sent_export: "Compared against the marked-up Word file that was sent to the property.",
  rebuilt_export:
    "The file sent to the property was not kept, so it was rebuilt from the contract and the decisions on record. " +
    "A decision changed since it was sent would make this differ from what they actually received.",
  received_docx:
    "The file sent to the property could not be rebuilt, so this compares against the contract as the property " +
    "sent it last round. Changes we asked for will show here as changes they made.",
  stored_text: "Compared against the stored text of the last round rather than the Word file, so clause structure is read from the text.",
  pdf_text: "The last round was a PDF, so its text was recovered from the stored file and read without document structure.",
};

export interface RoundDiff extends ComparedVersions {
  threadId: string | null;
  baselineAnalysisId: string;
  baselineRound: number;
  returnedAnalysisId: string;
  returnedRound: number;
  baselineSource: BaselineSource;
  confidence: Confidence;
  /** Plain language for the baseline, ready to show. */
  baselineExplanation: string;
}

export type RoundDiffOutcome = { ok: true; diff: RoundDiff } | { ok: false; reason: string };

type Admin = ReturnType<typeof createAdminClient>;

const ROUND_COLUMNS =
  "id, associate_id, thread_id, round_number, parent_analysis_id, filename, status, " +
  "source_format, intake_route, storage_path, original_storage_path, accepted_view_text";

interface RoundRow {
  id: string;
  associate_id: string;
  thread_id: string | null;
  round_number: number;
  parent_analysis_id: string | null;
  filename: string;
  status: string;
  source_format: "pdf" | "docx" | "doc";
  intake_route: "docx_native" | "pdf" | null;
  storage_path: string;
  original_storage_path: string | null;
  accepted_view_text: string | null;
}

async function download(admin: Admin, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Reads a DOCX into the shape a comparison takes, or null if it cannot be read. */
async function versionFromDocx(bytes: Uint8Array): Promise<VersionInput | null> {
  try {
    const joined = joinParts((await extractDocx(bytes)).parts);
    return { text: joined.text, document: joined };
  } catch {
    return null;
  }
}

/** Text recovered from a round's stored PDF, for a round with no Word file behind it. */
async function versionFromPdf(admin: Admin, round: RoundRow): Promise<VersionInput | null> {
  try {
    const pdfBytes = await download(admin, round.storage_path);
    if (!pdfBytes) return null;
    const lines = await getPositionedLines({
      admin,
      associateId: round.associate_id,
      analysisId: round.id,
      sourceFormat: round.source_format,
      pdfBytes,
    });
    return { text: lines.map((l) => l.text).join("\n"), document: null };
  } catch {
    return null;
  }
}

/**
 * The version that came back — always the document as uploaded, read as a DOCX
 * where there is one so revision marks and table cells are available.
 */
async function loadReturned(admin: Admin, round: RoundRow): Promise<VersionInput | null> {
  if (round.intake_route === "docx_native" && round.original_storage_path) {
    const bytes = await download(admin, round.original_storage_path);
    const version = bytes && (await versionFromDocx(bytes));
    if (version) return version;
  }
  if (round.accepted_view_text) return { text: round.accepted_view_text, document: null };
  return versionFromPdf(admin, round);
}

interface Baseline {
  version: VersionInput;
  source: BaselineSource;
}

/**
 * What we sent, best available. Each rung is tried in turn and the one that
 * answered is reported, so nothing downstream has to guess how solid the
 * comparison's left-hand side is.
 */
async function loadBaseline(admin: Admin, round: RoundRow): Promise<Baseline | null> {
  const { data: exportRows } = await admin
    .from("exports")
    .select("storage_path, outcome, created_at")
    .eq("analysis_id", round.id)
    .eq("format", "docx")
    .order("created_at", { ascending: false });

  // 1. The file we actually sent.
  for (const row of exportRows ?? []) {
    if (!row.storage_path) continue;
    const bytes = await download(admin, row.storage_path);
    const version = bytes && (await versionFromDocx(bytes));
    if (version) return { version, source: "sent_export" };
  }

  const original = round.original_storage_path ? await download(admin, round.original_storage_path) : null;

  // 2. Rebuilt, but only where a redline was genuinely sent. A fallback was
  //    discarded and a round with no docx export was never redlined at all,
  //    so rebuilding one would invent a document that never existed.
  const sentARedline = (exportRows ?? []).some((row) => row.outcome !== "fallback");
  if (original && sentARedline) {
    try {
      const { data: associate } = await admin
        .from("associates")
        .select("name")
        .eq("id", round.associate_id)
        .maybeSingle();
      const { findings } = await getActionedFindings(admin, round.id);
      const rebuilt = await generateRedline({
        originalDocxBytes: original,
        findings,
        author: associate?.name ?? "ConferenceDirect",
      });
      const version = await versionFromDocx(rebuilt.docxBytes);
      if (version) return { version, source: "rebuilt_export" };
    } catch {
      // Falls through to the plainer baselines below.
    }
  }

  // 3. The property's own draft from that round.
  if (original) {
    const version = await versionFromDocx(original);
    if (version) return { version, source: "received_docx" };
  }

  // 4. The text stored with the round.
  if (round.accepted_view_text) {
    return { version: { text: round.accepted_view_text, document: null }, source: "stored_text" };
  }

  // 5. Whatever the stored PDF can give up.
  const fromPdf = await versionFromPdf(admin, round);
  return fromPdf ? { version: fromPdf, source: "pdf_text" } : null;
}

/** The names our own revisions are signed with, for telling them from theirs. */
async function ourAuthors(admin: Admin, round: RoundRow): Promise<string[]> {
  const names = new Set<string>();

  const { data: exportRows } = await admin.from("exports").select("associate_id").eq("analysis_id", round.id);
  const ids = new Set<string>([round.associate_id, ...(exportRows ?? []).map((r) => r.associate_id)]);

  const { data: associates } = await admin.from("associates").select("name").in("id", [...ids]);
  for (const row of associates ?? []) if (row.name) names.add(row.name);

  return [...names];
}

/**
 * What the property changed between the round we sent and the round that came
 * back. Produces a comparison and nothing else — no finding is read, and none
 * is written. Turning a change into "they rejected this" is §2.1.2's job.
 */
export async function diffRound(admin: Admin, analysisId: string): Promise<RoundDiffOutcome> {
  const { data } = await admin.from("analyses").select(ROUND_COLUMNS).eq("id", analysisId).maybeSingle();
  const returnedRound = data as RoundRow | null;
  if (!returnedRound) return { ok: false, reason: "That analysis does not exist." };

  if (!returnedRound.parent_analysis_id) {
    return { ok: false, reason: "This is the first round of the negotiation, so there is nothing to compare it against." };
  }

  const { data: parent } = await admin
    .from("analyses")
    .select(ROUND_COLUMNS)
    .eq("id", returnedRound.parent_analysis_id)
    .maybeSingle();
  const baselineRound = parent as RoundRow | null;
  if (!baselineRound) return { ok: false, reason: "The previous round of this negotiation is no longer on file." };

  const [returned, baseline, ours] = await Promise.all([
    loadReturned(admin, returnedRound),
    loadBaseline(admin, baselineRound),
    ourAuthors(admin, baselineRound),
  ]);

  if (!returned) return { ok: false, reason: "This round's document could not be read." };
  if (!baseline) return { ok: false, reason: "Nothing on file for the previous round can be compared against." };

  return {
    ok: true,
    diff: {
      ...compareVersions(baseline.version, returned, { ours }),
      threadId: returnedRound.thread_id,
      baselineAnalysisId: baselineRound.id,
      baselineRound: baselineRound.round_number,
      returnedAnalysisId: returnedRound.id,
      returnedRound: returnedRound.round_number,
      baselineSource: baseline.source,
      confidence: CONFIDENCE_OF[baseline.source],
      baselineExplanation: BASELINE_EXPLANATION[baseline.source],
    },
  };
}
