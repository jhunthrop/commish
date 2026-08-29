import type { ReactElement, ReactNode } from "react";
import { MICRO_LABEL } from "./config";

export interface LowerThirdCell {
  readonly label: string;
  readonly value: ReactNode;
  /** The clock, drawn at the hero size in the live channel. At most one per strip. */
  readonly clock?: boolean;
}

export interface LowerThirdProps {
  /** Left to right, the facts the decision rests on. The verb is not one of these. */
  readonly cells: readonly LowerThirdCell[];
  /** The single act this screen is waiting on. Rendered last, in the amber verb. */
  readonly action?: ReactNode;
  /** Live tops the strip in the live channel rather than the furniture amber. */
  readonly live?: boolean;
}

/**
 * SUNDAY v5, LAW 6 — every screen ends in a lower third.
 *
 * The broadcast convention: a strip across the foot carrying the clock, the subject, and one
 * verb. On a draft board that is the pick clock, who is queued, and Draft. On a matchup it is the
 * game state and the act the week is waiting on.
 *
 * WHY THIS SETTLES THE OLD ARGUMENT. Through v4, rule 5 capped a view at one ink action, which
 * meant a board whose whole purpose is one repeated verb had to render that verb quietly. Law 6
 * replaces the cap with a PLACE: the lower third is where the verb lives, so the rest of the
 * screen is free to repeat it down a column without competing. The audit counts distinct verbs,
 * not instances, for the same reason.
 *
 * If a screen has no lower third, either it needs no decision, or the decision is hidden. That is
 * the diagnostic this component exists to make obvious.
 */
export function LowerThird({ cells, action, live = false }: LowerThirdProps): ReactElement {
  return (
    <div
      className={`flex flex-wrap items-stretch border-t-[3px] bg-surface-elevated ${
        live ? "border-live" : "border-accent"
      }`}
      data-live={live ? "true" : undefined}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col justify-center border-r border-line px-5 py-3 last:border-r-0">
          {/* The one sanctioned all-caps register (caps charter, S6) — imported, never
              hand-rolled, so the caps sweep keeps its single point of control. */}
          <span className={`${MICRO_LABEL} text-text-faint`}>{cell.label}</span>
          <span
            className={
              cell.clock === true
                ? "font-display text-display-lg leading-none font-extrabold tabular-nums text-live"
                : "font-display text-xl font-bold tabular-nums"
            }
          >
            {cell.value}
          </span>
        </div>
      ))}
      {action === undefined ? null : <div className="ml-auto flex items-center px-5 py-3">{action}</div>}
    </div>
  );
}
