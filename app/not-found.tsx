import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="text-center max-w-sm">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-[var(--cd-navy)] text-white text-sm font-bold mb-4">
          CD
        </span>
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Page not found</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Button size="sm" href="/">
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
