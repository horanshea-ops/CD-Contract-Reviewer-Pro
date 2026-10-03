"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FIELD_LABEL_CLASSES, Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { ContractDropZone } from "@/components/contract-drop-zone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Body, Meta, Title } from "@/components/ui/typography";

interface OpenThread {
  id: string;
  propertyName: string;
  clientName: string | null;
  roundCount: number;
}

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [negotiationMode, setNegotiationMode] = useState<"new" | "continuing">("new");
  const [propertyName, setPropertyName] = useState("");
  const [threads, setThreads] = useState<OpenThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch("/api/threads")
      .then((res) => res.json())
      .then((body) => setThreads(body.threads ?? []))
      .catch(() => setThreads([]));
  }, []);

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
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(body.error || "The upload didn't go through. Try again in a moment.");
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

        <form onSubmit={handleSubmit} className="space-y-5">
          <ContractDropZone
            id="contract-file"
            file={file}
            onFile={(picked) => {
              setFile(picked);
              if (picked) {
                setStatus("idle");
                setErrorMessage("");
              }
            }}
            onError={(message) => {
              setStatus("error");
              setErrorMessage(message);
            }}
          />

          <fieldset>
            <legend className={FIELD_LABEL_CLASSES}>Negotiation</legend>
            <SegmentedControl
              label="Negotiation"
              options={[
                { value: "new", label: "New negotiation" },
                { value: "continuing", label: "Continuing one" },
              ]}
              value={negotiationMode}
              onChange={setNegotiationMode}
            />
          </fieldset>

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

          <Field label="Client name" hint="(optional)">
            <FieldInput
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
            />
          </Field>

          <Button
            type="submit"
            size="lg"
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
