"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  processing: { label: "Analyzing...", className: "bg-[var(--cd-blue-pale)] text-[var(--cd-navy)]" },
  complete: { label: "Complete", className: "bg-[var(--surface-muted)] text-[var(--text-secondary)] border border-[var(--border)]" },
  failed: { label: "Failed", className: "bg-[var(--severity-high-bg)] text-[var(--severity-high)]" },
};

export interface RecentAnalysisRow {
  id: string;
  filename: string;
  status: string;
  created_at: string;
  clientName: string | null;
}

/** Recent-analyses table with a client-side search across contract name, client, date, and status. */
export function RecentAnalysesCard({ analyses }: { analyses: RecentAnalysisRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return analyses;
    return analyses.filter((a) => {
      const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.complete;
      const haystack = [a.filename, a.clientName ?? "", new Date(a.created_at).toLocaleDateString(), style.label]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [analyses, query]);

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] shrink-0">Recent analyses</h2>

        {analyses.length > 0 && (
          <div className="relative w-full max-w-xs">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
            >
              <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M16 16l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contract, client, date..."
              aria-label="Search recent analyses"
              className="w-full rounded-md border border-[var(--border-strong)] pl-8 pr-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]"
            />
          </div>
        )}
      </div>

      {analyses.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] px-5 py-8 text-center">
          Nothing yet — upload a contract to get started.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] px-5 py-8 text-center">
          No analyses match &quot;{query}&quot;.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="px-5 py-2 font-medium">Contract</th>
              <th className="px-5 py-2 font-medium">Client</th>
              <th className="px-5 py-2 font-medium">Date</th>
              <th className="px-5 py-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const style = STATUS_STYLE[a.status] ?? STATUS_STYLE.complete;
              return (
                <tr key={a.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-muted)]">
                  <td className="px-5 py-3">
                    <Link href={`/analyses/${a.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--cd-navy)]">
                      {a.filename}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">{a.clientName ?? "—"}</td>
                  <td className="px-5 py-3 text-[var(--text-secondary)]">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <StatusPill label={style.label} className={style.className} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
