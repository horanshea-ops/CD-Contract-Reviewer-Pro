import { outlineOf, sectionAt, type Section } from "../contract-outline";
import { isSynthetic, type ExtractedPart, type MapEntry, type SourceRef } from "../docx/types";
import {
  fateOfOurChanges,
  marksAcrossParts,
  authorsIn,
  type OurChangeFate,
  type RevisionMark,
} from "./attribution";
import { diffProjections, type Range, type RegionKind } from "./diff";
import { projectMapped, projectPlain, toSourceRange } from "./projection";

/**
 * Comparing one version of a contract against another (MASTER_PLAN.md §2.1.1).
 *
 * Pure over its input, in the manner of lib/negotiation-threads.ts: everything
 * here takes text and parts already in hand, so the whole comparison is
 * testable without a live Supabase project. Loading the two versions is
 * lib/round-diff/rounds.ts's job.
 */

export interface PartAt {
  part: ExtractedPart;
  /** Where this part's text begins in the joined text. */
  offset: number;
}

export interface JoinedDocument {
  text: string;
  /** Same length as `text`, with the part labels marked synthetic. */
  map: MapEntry[];
  parts: PartAt[];
}

/**
 * Joins the parts of an extracted document into the single text a round is
 * compared as, keeping a map and each part's offset.
 *
 * It must produce exactly what lib/docx/contract-text.ts produces, since that
 * is the text stored as `analyses.accepted_view_text` and a baseline from one
 * source has to line up with a returned version from the other. A test pins
 * the two against each other over the whole fixture corpus.
 */
export function joinParts(parts: ExtractedPart[]): JoinedDocument {
  let text = "";
  const map: MapEntry[] = [];
  const at: PartAt[] = [];

  for (const part of parts) {
    if (part.part !== "document") {
      const label = `\n\n[${part.part.toUpperCase()} — these terms form part of the agreement]\n`;
      text += label;
      for (let i = 0; i < label.length; i++) map.push({ synthetic: true });
    }
    at.push({ part, offset: text.length });
    text += part.text;
    for (const entry of part.map) map.push(entry);
  }

  // contract-text.ts trims the join, which shifts every offset after the lead.
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();

  return {
    text: trimmed,
    map: map.slice(lead, lead + trimmed.length),
    parts: at.map((p) => ({ ...p, offset: Math.max(0, p.offset - lead) })),
  };
}

export interface VersionInput {
  /** The accepted view of this version, as one text. */
  text: string;
  /** Maps and markup, when this version was read from a DOCX rather than stored as text. */
  document: JoinedDocument | null;
}

export interface SectionRef {
  number: string | null;
  label: string;
}

export interface ComparedRegion {
  kind: RegionKind;
  /** Where it sits in the version we sent. Zero-width where nothing was there. */
  baseline: Range;
  /** Where it sits in the version that came back. Zero-width where nothing is there now. */
  returned: Range;
  baselineText: string;
  returnedText: string;
  /** The clause it falls in, as the returned document numbers them. */
  section: SectionRef | null;
  /** The clause it fell in before, which is the number an earlier round's finding cites. */
  baselineSection: SectionRef | null;
  /** "document", "header1", and so on. Null when neither side carried a map. */
  part: string | null;
  /** Set when the change sits inside a table cell — where the money usually is. */
  cell: { tableIndex: number; cellIndex: number } | null;
  /** Revision authors whose marks touch this region. */
  authors: string[];
  /** Whether those authors were read off revision marks or nobody signed the change. */
  attribution: "tracked" | "inferred";
  /** For a move, the index of the region holding the other end of it. */
  moveCounterpart?: number;
}

export interface ComparedVersions {
  regions: ComparedRegion[];
  /** What became of the changes we made in the version we sent. */
  ourChanges: OurChangeFate[];
  /** Share of what we sent that came back untouched, 0 to 1. */
  retained: number;
  /** True when too little survived for a region-by-region answer to mean anything. */
  rebased: boolean;
  /** Which projector ran. "plain" reads structure off the text and is less exact. */
  projector: "mapped" | "plain";
  /** Set when revision marks could not be trusted; the regions are still good. */
  attributionUnavailable: string | null;
}

const asRef = (section: Section | null): SectionRef | null =>
  section && { number: section.number, label: section.label };

/**
 * The source reference nearest an offset, looking forward past the synthetic
 * structure an offset can land on — a table pipe, a list number, or the
 * position an insertion belongs at.
 */
function refNear(document: JoinedDocument | null, offset: number): SourceRef | null {
  if (!document) return null;
  const limit = Math.min(document.map.length, offset + 200);
  for (let i = Math.max(0, offset); i < limit; i++) {
    const entry = document.map[i];
    if (!isSynthetic(entry)) return entry;
  }
  return null;
}

export function compareVersions(
  baseline: VersionInput,
  returned: VersionInput,
  { ours }: { ours: string[] }
): ComparedVersions {
  // Both sides must go through the same projector. Mixing them would report
  // the difference between two projectors as a difference between two drafts.
  const mapped = Boolean(baseline.document && returned.document);
  const project = (version: VersionInput) =>
    mapped && version.document ? projectMapped(version.text, version.document.map) : projectPlain(version.text);

  const baselineProjection = project(baseline);
  const returnedProjection = project(returned);
  const diff = diffProjections(baselineProjection.text, returnedProjection.text);

  let baselineMarks: RevisionMark[] = [];
  let returnedMarks: RevisionMark[] = [];
  let attributionUnavailable: string | null = null;
  try {
    if (baseline.document) baselineMarks = marksAcrossParts(baseline.document.parts);
    if (returned.document) returnedMarks = marksAcrossParts(returned.document.parts);
  } catch (err) {
    baselineMarks = [];
    returnedMarks = [];
    attributionUnavailable = err instanceof Error ? err.message : String(err);
  }

  const baselineOutline = outlineOf(baseline.text);
  const returnedOutline = outlineOf(returned.text);

  const regions: ComparedRegion[] = diff.regions.map((region) => {
    const baselineRange = toSourceRange(baselineProjection, region.baseline.start, region.baseline.end);
    const returnedRange = toSourceRange(returnedProjection, region.returned.start, region.returned.end);
    const standing = returnedRange.end > returnedRange.start;

    const ref = standing
      ? refNear(returned.document, returnedRange.start)
      : refNear(baseline.document, baselineRange.start);
    // Always the returned document's marks. A deletion the property made sits
    // there as a zero-width mark; the baseline's marks answer a different
    // question, which fateOfOurChanges asks below.
    const authors = authorsIn(returnedMarks, returnedRange);
    const baselineSection = asRef(sectionAt(baselineOutline, baselineRange.start));
    const section = asRef(sectionAt(returnedOutline, returnedRange.start));

    return {
      kind: region.kind,
      baseline: baselineRange,
      returned: returnedRange,
      baselineText: baseline.text.slice(baselineRange.start, baselineRange.end),
      returnedText: returned.text.slice(returnedRange.start, returnedRange.end),
      section: section ?? baselineSection,
      baselineSection,
      part: ref?.part ?? null,
      cell: ref && ref.tableIndex !== null && ref.cellIndex !== null
        ? { tableIndex: ref.tableIndex, cellIndex: ref.cellIndex }
        : null,
      authors,
      attribution: authors.length > 0 ? "tracked" : "inferred",
      ...(region.moveCounterpart === undefined ? {} : { moveCounterpart: region.moveCounterpart }),
    } satisfies ComparedRegion;
  });

  return {
    regions,
    ourChanges: fateOfOurChanges(baselineMarks, ours, regions),
    retained: diff.retained,
    rebased: diff.rebased,
    projector: mapped ? "mapped" : "plain",
    attributionUnavailable,
  };
}
