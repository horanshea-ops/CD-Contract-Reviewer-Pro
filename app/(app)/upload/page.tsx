"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, FieldInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setStatus("uploading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("file", file);
    if (clientName.trim()) formData.append("clientName", clientName.trim());

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
            <FieldInput
              type="file"
              accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              PDF, DOCX, or DOC, up to 32MB. DOCX/DOC are converted to text for review — original
              formatting isn&apos;t preserved.
            </p>
          </Field>

          <Field label="Client name" hint="(optional)">
            <FieldInput
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
            />
          </Field>

          <Button type="submit" fullWidth disabled={!file} loading={status === "uploading"} loadingText="Uploading...">
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
