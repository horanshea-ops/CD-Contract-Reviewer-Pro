"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import FindingCard, { type Finding } from "./finding-card";

interface AnalysisResponse {
  id: string;
  filename: string;
  status: "queued" | "processing" | "complete" | "failed";
  error: string | null;
  created_at: string;
  model_id: string | null;
  library_version: string | null;
  documentUrl: string | null;
  findings: Finding[];
  error_message?: string;
}

const POLL_INTERVAL_MS = 2000;

export default function AnalysisPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/analyses/${params.id}`);
        const body = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setLoadError(body.error || "Could not load this analysis.");
          return;
        }

        setData(body);

        if (body.status === "queued" || body.status === "processing") {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) setLoadError("Lost connection while checking status.");
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.id]);

  useEffect(() => {
    if (!data || data.status === "complete" || data.status === "failed") return;
    const interval = setInterval(() => {
      if (startedAt.current == null) return;
      setElapsedSeconds(Math.round((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [data]);

  function handleActionRecorded(findingId: string, action: Finding["current_action"]) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            findings: prev.findings.map((f) => (f.id === findingId ? { ...f, current_action: action } : f)),
          }
        : prev
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <div className="text-center">
          <p className="text-sm text-red-600 mb-2">{loadError}</p>
          <Link href="/upload" className="text-sm text-neutral-500 underline">
            Try uploading again
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">Loading...</p>
      </div>
    );
  }

  if (data.status === "queued" || data.status === "processing") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium text-neutral-900 mb-1">
            {data.status === "queued" ? "Queued..." : "Analyzing " + data.filename}
          </p>
          <p className="text-sm text-neutral-500 mb-3">
            Usually 30-90 seconds, up to a few minutes for long contracts. ({elapsedSeconds}s elapsed)
          </p>
          <div className="h-1.5 w-full rounded bg-neutral-200 overflow-hidden">
            <div className="h-full w-1/3 bg-neutral-900 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
        <div className="text-center max-w-md">
          <p className="text-sm font-medium text-red-700 mb-1">Analysis failed</p>
          <p className="text-sm text-neutral-600 mb-4">
            {data.error || "Something went wrong processing this contract."}
          </p>
          <Link href="/upload" className="text-sm text-neutral-500 underline">
            Try again
          </Link>
        </div>
      </div>
    );
  }

  const sortedFindings = [...data.findings].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2, note: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="border-b border-neutral-200 bg-white px-6 py-3 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-neutral-400 hover:text-neutral-700">
            ← Back
          </Link>
          <h1 className="text-sm font-semibold text-neutral-900">{data.filename}</h1>
        </div>
        <p className="text-xs text-neutral-400">
          {sortedFindings.length} finding{sortedFindings.length === 1 ? "" : "s"} · not legal advice — review each one
        </p>
      </div>

      <div className="flex flex-col lg:flex-row" style={{ height: "calc(100vh - 53px)" }}>
        <div className="lg:w-1/2 border-r border-neutral-200 bg-neutral-100">
          {data.documentUrl ? (
            <iframe src={data.documentUrl} className="w-full h-full" title="Contract document" />
          ) : (
            <p className="p-6 text-sm text-neutral-500">Document preview unavailable.</p>
          )}
        </div>

        <div className="lg:w-1/2 overflow-y-auto px-4 py-4 space-y-3">
          {sortedFindings.length === 0 ? (
            <p className="text-sm text-neutral-500">No findings — nothing flagged against the standards library.</p>
          ) : (
            sortedFindings.map((f) => (
              <FindingCard key={f.id} finding={f} onActionRecorded={handleActionRecorded} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
