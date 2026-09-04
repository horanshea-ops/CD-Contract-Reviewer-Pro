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
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-xl">
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Back
        </Link>
        <h1 className="text-lg font-semibold text-neutral-900 mt-3 mb-1">Review a contract</h1>
        <p className="text-sm text-neutral-500 mb-6">
          PDF only, up to 32MB. This is a negotiating aid, not legal advice — review every
          finding yourself before sending anything to a property.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Contract (PDF)</label>
            <input
              type="file"
              accept="application/pdf"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Client name <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <button
            type="submit"
            disabled={!file || status === "uploading"}
            className="w-full rounded bg-neutral-900 text-white text-sm font-medium py-2 disabled:opacity-50"
          >
            {status === "uploading" ? "Uploading..." : "Start review"}
          </button>

          {status === "error" && <p className="text-sm text-red-600">{errorMessage}</p>}
        </form>
      </div>
    </div>
  );
}
