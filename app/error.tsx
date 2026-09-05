"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="text-center max-w-sm">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-[var(--cd-navy)] text-white text-sm font-bold mb-4">
          CD
        </span>
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Something went wrong</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          An unexpected error occurred. Try again, or head back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" href="/">
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
