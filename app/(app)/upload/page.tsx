"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface OpenThread {
  id: string;
  propertyName: string;
  clientName: string | null;
  roundCount: number;
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
    if (dropped) setFile(dropped);
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
      setErrorMessage("Upload failed — check your connection and try again.");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>

      <Card padding="lg" elevated className="mt-4">
        <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight mb-1">Review a contract</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          This is a negotiating aid, not legal advice — review every finding yourself before
          sending anything to a property.
        </p>

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
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">PDF, DOCX, or DOC, up to 32MB.</p>
              <p className="text-xs text-[var(--text-muted)] mt-2">
                Drag and drop a file here, or use the button above.
              </p>
              {file && (
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Selected: <span className="font-medium">{file.name}</span>
                </p>
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

          <Field label="Negotiation">
            <div className="flex gap-2 mb-2">
              <Button
                type="button"
                size="sm"
                variant={negotiationMode === "new" ? "primary" : "secondary"}
                onClick={() => setNegotiationMode("new")}
              >
                New negotiation
              </Button>
              <Button
                type="button"
                size="sm"
                variant={negotiationMode === "continuing" ? "primary" : "secondary"}
                onClick={() => setNegotiationMode("continuing")}
              >
                Continuing one
              </Button>
            </div>

            {negotiationMode === "new" ? (
              <FieldInput
                type="text"
                value={propertyName}
                onChange={(e) => setPropertyName(e.target.value)}
                placeholder="e.g. Hilton Downtown Denver"
                required
              />
            ) : threads.length > 0 ? (
              <FieldSelect value={threadId} onChange={(e) => setThreadId(e.target.value)} required>
                <option value="" disabled>
                  Choose a negotiation…
                </option>
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.propertyName}
                    {t.clientName ? ` — ${t.clientName}` : ""} (round {t.roundCount} so far)
                  </option>
                ))}
              </FieldSelect>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                No open negotiations yet — start one with &quot;New negotiation&quot; above.
              </p>
            )}
          </Field>

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
            <p role="alert" className="text-sm text-[var(--severity-high)]">
              {errorMessage}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
