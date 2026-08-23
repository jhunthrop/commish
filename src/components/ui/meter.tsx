export interface MeterProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly className?: string;
}

/**
 * A labeled fill bar, always paired with its own number — `public-league-list.tsx`'s own no-bar
 * ruling, generalized: the bar is the glance and the number is the decision, so this primitive
 * cannot be constructed without the number. `max <= 0` renders an empty bar rather than dividing
 * by zero.
 */
export function Meter({ label, value, max, className = "" }: MeterProps) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between gap-2 text-sm text-text-muted">
        <span>{label}</span>
        <span className="font-mono font-medium tabular-nums text-text-primary">{`${value} of ${max}`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-inset">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
