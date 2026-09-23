"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Body, Meta, Title } from "@/components/ui/typography";
import { cn } from "@/lib/cn";

interface OpenThread {
  id: string;
  propertyName: string;
  clientName: string | null;
  roundCount: number;
}

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc"];
const UNSUPPORTED_TYPE_MESSAGE = "Unsupported file type. Upload a PDF, DOCX, or DOC contract.";

// Drag-and-drop bypasses the file input's `accept` filter entirely, and a
// dropped file's `type` can be empty depending on OS/browser — checking the
// extension is what actually works for both paths.
function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [negotiationMode, setNegotiationMode] = useState<"new" | "continuing">("new");
  const [propertyName, setPropertyName] = useState("");
  const [threads, setThreads] = useState<OpenThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    fetch("/api/threads")
      .then((res) => res.json())
      .then((body) => setThreads(body.threads ?? []))
      .catch(() => setThreads([]));
  }, []);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!hasAcceptedExtension(dropped.name)) {
      setFile(null);
      setStatus("error");
      setErrorMessage(UNSUPPORTED_TYPE_MESSAGE);
      return;
    }
    setStatus("idle");
    setErrorMessage("");
    setFile(dropped);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    if (selected && !hasAcceptedExtension(selected.name)) {
      setFile(null);
      setStatus("error");
      setErrorMessage(UNSUPPORTED_TYPE_MESSAGE);
      return;
    }
    setStatus("idle");
    setErrorMessage("");
    setFile(selected);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (negotiationMode === "new" && !propertyName.trim()) {
      setStatus("error");
      setErrorMessage("Property name is required for a new negotiation.");
      return;
    }
    if (negotiationMode === "continuing" && !threadId) {
      setStatus("error");
      setErrorMessage("Choose which negotiation this continues.");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("file", file);
    if (clientName.trim()) formData.append("clientName", clientName.trim());
    formData.append("negotiationMode", negotiationMode);
    if (negotiationMode === "new") {
      formData.append("propertyName", propertyName.trim());
    } else {
      formData.append("threadId", threadId);
    }

    try {
      const res = await fetch("/api/analyses", { method: "POST", body: formData });
      const body = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(body.error || "Upload failed.");
        return;
      }

      router.push(`/analyses/${body.analysisId}`);
    } catch {
      setStatus("error");
      setErrorMessage("Upload failed. Check your connection and try again.");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>

      <Card padding="lg" className="mt-4">
        <Title className="text-[var(--text-primary)] tracking-tight mb-1">Review a contract</Title>
        <Body as="p" className="text-[var(--text-secondary)] mb-6">
          This is a negotiating aid, not legal advice. Review every finding yourself before sending anything to a
          property.
        </Body>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Contract">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragActive(false);
              }}
              onDrop={handleDrop}
              className={cn(
                "rounded-md border-2 border-dashed p-3 transition-colors",
                dragActive
                  ? "border-[var(--cd-blue)] bg-[var(--cd-blue)]/5"
                  : "border-[var(--border-strong)]"
              )}
            >
              <FieldInput
                type="file"
                accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                required
                onChange={handleFileInputChange}
              />
              <Meta as="p" className="text-[var(--text-muted)] mt-1">
                PDF, DOCX, or DOC, up to 32MB.
              </Meta>
              <Meta as="p" className="text-[var(--text-muted)] mt-2">
                Drag and drop a file here, or use the button above.
              </Meta>
              {file && (
                <Meta as="p" className="text-[var(--text-secondary)] mt-1">
                  Selected: <span className="font-medium">{file.name}</span>
                </Meta>
              )}
            </div>
          </Field>

          <Field label="Client name" hint="(optional)">
            <FieldInput
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
            />
          </Field>

          <div>
            <p className="block text-sm font-medium text-[var(--text-primary)] mb-1">Negotiation</p>
            <div
              role="radiogroup"
              aria-label="Negotiation"
              className="inline-flex rounded-md border border-[var(--border-strong)] p-0.5 mb-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={negotiationMode === "new"}
                onClick={() => setNegotiationMode("new")}
                className={cn(
                  "rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]",
                  negotiationMode === "new"
                    ? "bg-[var(--cd-navy)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                New negotiation
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={negotiationMode === "continuing"}
                onClick={() => setNegotiationMode("continuing")}
                className={cn(
                  "rounded-[5px] px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]",
                  negotiationMode === "continuing"
                    ? "bg-[var(--cd-navy)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                )}
              >
                Continuing one
              </button>
            </div>

            {negotiationMode === "new" ? (
              <Field label="Property name">
                <FieldInput
                  type="text"
                  value={propertyName}
                  onChange={(e) => setPropertyName(e.target.value)}
                  placeholder="e.g. Hilton Downtown Denver"
                  required
                />
              </Field>
            ) : threads.length > 0 ? (
              <Field label="Which negotiation">
                <FieldSelect value={threadId} onChange={(e) => setThreadId(e.target.value)} required>
                  <option value="" disabled>
                    Choose a negotiation…
                  </option>
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.propertyName}
                      {t.clientName ? ` · ${t.clientName}` : ""} (round {t.roundCount} so far)
                    </option>
                  ))}
                </FieldSelect>
              </Field>
            ) : (
              <Meta as="p" className="text-[var(--text-muted)]">
                No open negotiations yet. Start one with &quot;New negotiation&quot; above.
              </Meta>
            )}
          </div>

          <Button
            type="submit"
            fullWidth
            disabled={!file}
            loading={status === "uploading"}
            loadingText="Uploading..."
          >
            Start review
          </Button>

          {status === "error" && (
            <Body as="p" role="alert" className="text-[var(--severity-high)]">
              {errorMessage}
            </Body>
          )}
        </form>
      </Card>
    </div>
  );
}
