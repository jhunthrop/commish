import type { HTMLAttributes, ReactNode } from "react";

export interface LedgerRowProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: ReactNode;
}

/**
 * One hairline-topped ledger row: quiet key left, value right (rule 4 — structure from thin
 * rules and space, never boxes). `OpenLeagueCard` (Phase 3.7, Task 5) established the shape for
 * the public browse card; extracted here at its second caller, `HomeLeagueCard` (Task 9), so the
 * public shelf and the signed-in home read as one product rather than two hand-rolled copies of
 * the same row that could drift apart. `...rest` (role, aria-label, etc.) passes straight to the
 * outer `div` — `HomeLeagueCard`'s Record row needs `role="group"` for its own accessible name.
 */
export function LedgerRow({ label, children, className = "", ...rest }: LedgerRowProps) {
  return (
    <div className={`flex items-baseline justify-between gap-2 border-t border-line py-1.5 text-sm ${className}`} {...rest}>
      <span className="inline-flex shrink-0 items-center gap-1 text-text-muted">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
