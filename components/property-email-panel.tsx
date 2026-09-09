"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldInput, FieldTextarea, Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

interface Draft {
  id: string;
  subject: string;
  body: string;
}

/**
 * §1.8.3 — the cover email that goes to the property with the redline.
 * Generate/edit/copy/download only. No send affordance anywhere, per the
 * standing constraint that nothing is ever sent from this tool.
 *
 * Kept as its own component rather than an audience toggle on the client
 * panel. One switch between the two audiences is one mis-click away from
 * sending CD's exposure figures to the counterparty, and separating them in
 * the UI is the same reasoning that separates them in the assembly code.
 */
export function PropertyEmailPanel({ analysisId }: { analysisId: string }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);

  async function openAndGenerate() {
    setOpen(true);
    if (draft) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/property-email-draft`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        showToast(body.error ?? "Could not draft the email.", "error");
        setOpen(false);
        return;
      }
      setDraft({ id: body.id, subject: body.subject, body: body.body });
      setSignature(body.signatureBlock ?? "");
    } catch {
      showToast("Could not reach the server.", "error");
      setOpen(false);
    } finally {
      setGenerating(false);
    }
  }

  async function saveDraft(fields: Partial<Pick<Draft, "subject" | "body">>) {
    if (!draft) return;
    setSaving(true);
    try {
      await fetch(`/api/email-drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveSignature() {
    try {
      await fetch("/api/associates/me/signature", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureBlock: signature }),
      });
    } catch {
      showToast("Could not save your signature.", "error");
    }
  }

  function fullText() {
    return `${draft?.body ?? ""}\n\n${signature}`;
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(fullText());
      showToast("Copied to clipboard.", "success");
    } catch {
      showToast("Could not copy — select and copy manually.", "error");
    }
  }

  function downloadEml() {
    if (!draft) return;
    const eml = `Subject: ${draft.subject}\nContent-Type: text/plain; charset=utf-8\n\n${fullText()}`;
    const blob = new Blob([eml], { type: "message/rfc822" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // Named for the audience so the two drafts can't be confused once they
    // leave the app and sit next to each other in a downloads folder.
    a.download = `property-email-${analysisId.slice(0, 8)}.eml`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openAndGenerate} className="shrink-0">
        Draft property email
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-lg bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Email to the property</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                Close
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-2">
              Goes to the counterparty with the marked-up contract. Review and edit before sending — nothing is
              sent from here.
            </p>
            <p className="text-xs text-[var(--cd-navy)] bg-[var(--cd-blue-pale)] rounded px-2 py-1.5 mb-4">
              Exposure figures, severity ratings and the reasons behind each change are excluded from this
              draft by design — they are negotiating leverage. If you add any while editing, they go to the
              property.
            </p>

            {generating ? (
              <p className="text-sm text-[var(--text-secondary)] py-8 text-center">Drafting...</p>
            ) : draft ? (
              <div className="space-y-3">
                <Field label="Subject">
                  <FieldInput
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    onBlur={() => saveDraft({ subject: draft.subject })}
                  />
                </Field>
                <Field label="Body">
                  <FieldTextarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    onBlur={() => saveDraft({ body: draft.body })}
                    rows={12}
                  />
                </Field>
                <Field label="Signature" hint="Remembered for next time">
                  <FieldTextarea
                    value={signature}
                    onChange={(e) => setSignature(e.target.value)}
                    onBlur={saveSignature}
                    rows={3}
                  />
                </Field>

                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-[var(--text-muted)]">{saving ? "Saving..." : ""}</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={copyToClipboard}>
                      Copy
                    </Button>
                    <Button size="sm" onClick={downloadEml}>
                      Download .eml
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
