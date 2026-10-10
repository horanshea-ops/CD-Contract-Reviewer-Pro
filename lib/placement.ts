import { locateQuote, type LocatablePart } from "./redline-engine/locate";
import { isLocated } from "./redline-engine/types";
import type { LatestAction } from "./finding-actions";

/**
 * Giving a change a place in the Word file, by the associate's choice.
 *
 * The associate either picks the contract wording the change replaces, or
 * sends the change to the property in the email. Either is saved as a new
 * decision row, so the history of what they chose is kept like any other.
 */

/** What the card sends. */
export interface PlacementInput {
  /** The contract wording the change replaces. */
  quote?: string;
  /** The wording just before it. */
  context?: string;
  /** True to send the change by email, false to put it back in the redline. */
  byEmail?: boolean;
}

/** Null when the wording is found in exactly one place, or what to tell the associate when it isn't. */
export function placementProblem(parts: LocatablePart[], quote: string, section: string | null, context: string | null): string | null {
  if (!quote.trim()) return "Select the wording in the document that this change replaces.";

  const found = locateQuote(parts, quote, section, context);
  if (isLocated(found)) return null;
  if (found.ambiguous) {
    return `That wording appears ${found.places?.length ?? "several"} times in the contract. Select a little more of it, so it appears once.`;
  }
  return "That wording isn't in the contract. Select it again in the document.";
}

/** The fields of a decision that say where its change belongs. */
type Placement = Pick<LatestAction, "edited_quote" | "quote_context" | "by_email">;

/**
 * The decision row a placement saves. Placing a change accepts it, and keeps
 * the associate's own wording where they had edited it.
 */
export function placementRow(latest: LatestAction | null, input: PlacementInput) {
  const edited = latest?.action === "edit" && latest.edited_language ? latest.edited_language : null;
  return {
    action: edited ? "edit" : "accept",
    edited_language: edited,
    edited_quote: input.quote !== undefined ? input.quote : (latest?.edited_quote ?? null),
    quote_context: input.quote !== undefined ? (input.context ?? null) : (latest?.quote_context ?? null),
    by_email: input.byEmail ?? false,
  };
}

/**
 * The placement a later accept or edit keeps. Empty for a decision that never
 * had one, so a database from before these columns is never asked to store them.
 */
export function carriedPlacement(latest: LatestAction | null): Partial<Placement> {
  if (!latest || latest.action === "dismiss") return {};
  const carried: Partial<Placement> = {};
  if (latest.edited_quote !== null) carried.edited_quote = latest.edited_quote;
  if (latest.quote_context !== null) carried.quote_context = latest.quote_context;
  if (latest.by_email) carried.by_email = true;
  return carried;
}
