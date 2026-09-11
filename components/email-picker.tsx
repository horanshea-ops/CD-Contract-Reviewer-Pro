"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientEmailPanel } from "@/components/client-email-panel";
import { PropertyEmailPanel } from "@/components/property-email-panel";
import { ORG } from "@/lib/org";

/**
 * One "Email" button over the two draft audiences, replacing two separate
 * buttons ("Draft client email" / "Draft property email"). The user overrode
 * §1.8.3's separation on 2026-09-09 — it is the associate's to manage rather
 * than enforced by keeping the buttons apart.
 *
 * The audience choice is the one place a wrong click has real consequences —
 * the client draft carries CD's exposure figures and reasoning, and nothing
 * downstream stops it from being sent to the property by mistake. So the two
 * choices below are full-width, separately labeled and described, not a
 * compact toggle. Both panels stay mounted here (not just when picked) so a
 * generated draft survives closing and reopening — same caching behavior
 * each panel already had on its own.
 */
export function EmailPicker({ analysisId }: { analysisId: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<"client" | "property" | null>(null);

  function choose(panel: "client" | "property") {
    setPickerOpen(false);
    setActivePanel(panel);
  }

  return (
    <>
      <Button size="sm" onClick={() => setPickerOpen(true)} className="shrink-0">
        Email
      </Button>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Who is this email for?</h2>

            <div className="mt-4 space-y-3">
              <button
                onClick={() => choose("client")}
                className="w-full rounded border border-[var(--border-strong)] p-3 text-left hover:bg-[var(--surface-muted)]"
              >
                <span className="block text-xs font-medium text-[var(--text-primary)]">Client</span>
                <span className="block mt-1 text-xs text-[var(--text-secondary)]">
                  Internal email for the firm, including {ORG.shortName}&apos;s exposure figures and negotiating rationale.
                  Never send this to the property.
                </span>
              </button>

              <button
                onClick={() => choose("property")}
                className="w-full rounded border border-[var(--border-strong)] p-3 text-left hover:bg-[var(--surface-muted)]"
              >
                <span className="block text-xs font-medium text-[var(--text-primary)]">Property</span>
                <span className="block mt-1 text-xs text-[var(--text-secondary)]">
                  Cover email to the counterparty with the marked-up contract. Exposure figures and reasoning
                  are excluded automatically.
                </span>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <ClientEmailPanel analysisId={analysisId} open={activePanel === "client"} onClose={() => setActivePanel(null)} />
      <PropertyEmailPanel
        analysisId={analysisId}
        open={activePanel === "property"}
        onClose={() => setActivePanel(null)}
      />
    </>
  );
}
