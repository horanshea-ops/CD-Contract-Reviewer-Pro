"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

      <div className="rounded-lg border border-[var(--border)] bg-white p-6 mt-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Review a contract</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          PDF only, up to 32MB. This is a negotiating aid, not legal advice — review every
          finding yourself before sending anything to a property.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">Contract (PDF)</label>
            <input
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--cd-navy)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white file:cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--text-primary)] mb-1">
              Client name <span className="text-[var(--text-muted)] font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
              className="w-full rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
            />
          </div>

          <button
            type="submit"
            disabled={!file || status === "uploading"}
            className="w-full rounded-md bg-[var(--cd-navy)] text-white text-sm font-medium py-2.5 hover:bg-[var(--cd-navy-dark)] transition-colors disabled:opacity-50"
          >
            {status === "uploading" ? "Uploading..." : "Start review"}
          </button>

          {status === "error" && <p className="text-sm text-[var(--severity-high)]">{errorMessage}</p>}
        </form>
      </div>
    </div>
  );
}
