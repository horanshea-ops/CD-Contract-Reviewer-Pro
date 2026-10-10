"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Meta } from "@/components/ui/typography";
import { placementMessage } from "@/lib/placement-message";
import ChangeView from "./change-view";
import type { Finding } from "./finding-card";

/**
 * A change the redline has no place for, with a way to give it one.
 *
 * The redline engine says what is wrong when the review screen loads, so the
 * associate settles it here, while deciding, and never at export. Each kind of
 * problem gets its own action: pick one of several places, select the wording
 * in the document, keep one of two overlapping changes, or send the change in
 * the email to the property.
 */

/** Wording the associate selected in the document pane for this change. */
export interface PickedWording {
  quote: string;
  context: string;
}

type Placement = NonNullable<Finding["placement"]>;

/** Wording around a place, for reading. The review's text marks a table with pipes and a rule under its first row. */
const forReading = (text: string) =>
  text
    .replace(/(?:\|\s*-{3,}\s*)+\|?/g, " ")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/(?:\s*·\s*){2,}/g, " · ")
    .replace(/\s+/g, " ");

export default function PlacementFix({
  finding,
  placement,
  language,
  conflictLabel,
  canPick,
  picking,
  picked,
  onStartPick,
  onCancelPick,
  onDismiss,
  onActionRecorded,
}: {
  finding: Finding;
  placement: Placement;
  /** The wording the change proposes, for showing it against wording the associate selects. */
  language: string;
  conflictLabel: string | null;
  /** False where the document pane can't offer a selection, as for a PDF upload. */
  canPick: boolean;
  picking: boolean;
  picked: PickedWording | null;
  onStartPick: () => void;
  onCancelPick: () => void;
  /** Dismisses this change or the one it overlaps. */
  onDismiss: (findingId: string) => Promise<void>;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { showToast } = useToast();

  async function save(body: { quote?: string; context?: string; byEmail?: boolean }, done: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/findings/${finding.id}/placement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const saved = await res.json();
      if (!res.ok) {
        setError(saved.error || "Could not save.");
        return;
      }
      onCancelPick();
      onActionRecorded(finding.id, {
        action: saved.action,
        edited_language: saved.edited_language ?? null,
        dismissal_reason: null,
        edited_quote: saved.edited_quote ?? null,
        by_email: !!saved.by_email,
      });
      showToast(done);
    } catch {
      setError("Not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const overlap = placement.reason === "overlaps_another_change" && placement.conflictsWith;
  const places = placement.reason === "ambiguous_quote" ? (placement.places ?? []) : [];
  // Selecting wording helps when the quote is the trouble. A row that won't split into its columns needs an edit.
  const quoteIsTheTrouble = placement.reason === "not_located" || placement.reason === "ambiguous_quote";

  return (
    <div className="mt-3 space-y-2 rounded-md border border-[var(--border)] px-3 py-2.5">
      <Meta as="p" className="text-[var(--text-primary)]">
        {placementMessage(placement, conflictLabel)}
      </Meta>

      {overlap && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDismiss(placement.conflictsWith!)} disabled={saving}>
            Keep this one
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onDismiss(finding.id)} disabled={saving}>
            Keep the other
          </Button>
        </div>
      )}

      {places.length > 0 && !picked && (
        <ul className="space-y-1.5">
          {places.map((place, i) => (
            <li key={i} className="flex items-start justify-between gap-3 rounded border border-[var(--border)] bg-white px-2 py-1.5">
              <Meta as="p" className="text-[var(--text-secondary)]">
                …{forReading(place.before)}
                <span className="font-semibold text-[var(--text-primary)]">{place.match}</span>
                {forReading(place.after)}…
              </Meta>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={saving}
                onClick={() => save({ quote: finding.current_action?.edited_quote ?? finding.quoted_text ?? "", context: place.before }, "Placed and accepted.")}
              >
                This one
              </Button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <div className="space-y-2">
          <ChangeView quote={picked.quote} language={language} addition={false} />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => save({ quote: picked.quote, context: picked.context }, "Placed and accepted.")}
              loading={saving}
              loadingText="Saving..."
            >
              Use this wording and accept
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancelPick} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!overlap && !picked && (
        <div className="flex flex-wrap gap-2">
          {canPick &&
            quoteIsTheTrouble &&
            (picking ? (
              <Button variant="ghost" size="sm" onClick={onCancelPick}>
                Stop selecting
              </Button>
            ) : (
              <Button size="sm" variant={places.length > 0 ? "secondary" : "primary"} onClick={onStartPick} disabled={saving}>
                Show me where
              </Button>
            ))}
          <Button variant="secondary" size="sm" onClick={() => save({ byEmail: true }, "It will go in the email to the property.")} disabled={saving}>
            Send this in the email to the property
          </Button>
        </div>
      )}

      {error && (
        <Meta as="p" role="alert" className="text-[var(--severity-high)]">
          {error}
        </Meta>
      )}
    </div>
  );
}

/** A change the associate chose to send by email, with the way back. */
export function SentByEmail({
  finding,
  onActionRecorded,
}: {
  finding: Finding;
  onActionRecorded: (findingId: string, action: Finding["current_action"]) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function putBack() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/findings/${finding.id}/placement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ byEmail: false }),
      });
      const saved = await res.json();
      if (!res.ok) {
        setError(saved.error || "Could not save.");
        return;
      }
      onActionRecorded(finding.id, {
        action: saved.action,
        edited_language: saved.edited_language ?? null,
        dismissal_reason: null,
        edited_quote: saved.edited_quote ?? null,
        by_email: false,
      });
    } catch {
      setError("Not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] px-3 py-2.5">
      <Meta as="p" className="text-[var(--text-primary)]">
        This change goes to the property in the email. The redline doesn&apos;t carry it.
      </Meta>
      <button
        type="button"
        onClick={putBack}
        disabled={saving}
        className="mt-1 text-xs text-[var(--cd-navy)] hover:underline disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]"
      >
        Put it back in the redline
      </button>
      {error && (
        <Meta as="p" role="alert" className="mt-1 text-[var(--severity-high)]">
          {error}
        </Meta>
      )}
    </div>
  );
}
