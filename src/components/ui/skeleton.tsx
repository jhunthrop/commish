export interface SkeletonProps {
  readonly lines?: number;
  readonly className?: string;
}

const FULL_WIDTH_PCT = 100;
const WIDTH_STEP_PCT = 12;
const MIN_WIDTH_PCT = 40;

function lineWidthPct(index: number): number {
  return Math.max(MIN_WIDTH_PCT, FULL_WIDTH_PCT - index * WIDTH_STEP_PCT);
}

export function Skeleton({ lines = 3, className = "" }: SkeletonProps) {
  const lineCount = Math.max(0, Math.floor(lines));
  return (
    <div aria-busy="true" aria-live="polite" className={`flex flex-col gap-2 ${className}`}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: lineCount }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-4 animate-pulse rounded-sm bg-border/40" style={{ width: `${lineWidthPct(i)}%` }} />
      ))}
    </div>
  );
}
