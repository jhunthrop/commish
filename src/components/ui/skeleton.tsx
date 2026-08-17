export interface SkeletonProps {
  readonly lines?: number;
  readonly className?: string;
}

export function Skeleton({ lines = 3, className = "" }: SkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite" className={`flex flex-col gap-2 ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-4 animate-pulse rounded-sm bg-border/40" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  );
}
