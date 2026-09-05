export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 animate-pulse">
      <div className="h-6 w-40 rounded bg-[var(--border)] mb-2" />
      <div className="h-4 w-56 rounded bg-[var(--border)] mb-8" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-md border border-[var(--border)] bg-white" />
        ))}
      </div>
      <div className="h-40 rounded-md border border-[var(--border)] bg-white" />
    </div>
  );
}
