import { Meter, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { DraftPlan, PlanTarget, PlanTurn } from "@/draft-service/assistant/view";
import { isReachAt, percentText, pickLabel } from "../format";

export interface PlanRailProps {
  readonly plan: DraftPlan;
  readonly teamCount: number;
  readonly nameOf: (playerId: string) => string;
  /** "Changed since 4.03" lines, already worded. Empty when nothing moved. */
  readonly changedSince: readonly string[];
  readonly changedSincePick: number | null;
  readonly recomputing: boolean;
}

function TargetRow({ target, turn, plan, teamCount, nameOf }: { readonly target: PlanTarget; readonly turn: PlanTurn; readonly plan: DraftPlan; readonly teamCount: number; readonly nameOf: (playerId: string) => string }) {
  const own = target.oddsByTurn[turn.turn - 1] ?? null;
  return (
    <li data-testid="advisor-plan-target" className="flex flex-col gap-1 rounded-md bg-surface-raised px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        <PositionBadge position={target.position} rank={target.positionRank} size="sm" />
        <span className="min-w-0 flex-1 truncate font-display text-md font-semibold text-text-primary">{nameOf(target.playerId)}</span>
        <span className="font-mono text-xs tabular-nums text-text-faint">+{target.valueOverReplacement.toFixed(1)}</span>
      </div>
      {own === null ? (
        <span className="text-xs text-text-faint">No odds for this turn.</span>
      ) : (
        <Meter label={`Still there at ${pickLabel(turn.pickNumber, teamCount)}`} value={Math.round(own.survival * own.runs)} max={own.runs} />
      )}
      <div className="flex flex-wrap items-center gap-x-2 font-mono text-xs tabular-nums text-text-faint">
        {plan.turns.map((column, index) => {
          const cell = target.oddsByTurn[index] ?? null;
          const reach = isReachAt(target, column.turn);
          return (
            <span key={column.turn} data-testid="advisor-odds-column" data-reach={reach ? "true" : undefined} className={reach ? "text-negative" : ""}>
              {pickLabel(column.pickNumber, teamCount)} {cell === null ? "no odds" : percentText(cell.survival)}
              {reach ? " reach" : ""}
            </span>
          );
        })}
      </div>
    </li>
  );
}

/**
 * BAND TWO — the plan rail (spec 3.1 and 3.6): one column per upcoming turn, the targets
 * stacked with their odds as a meter whose number is the simulator's own run fraction, the
 * odds at every other column beside it, a reach named where it applies, the fallback if they
 * go. Stamped "as of" the pick it was computed at, with what changed since the plan the manager
 * last saw. Three columns on a desk, stacked on a phone.
 */
export function PlanRail({ plan, teamCount, nameOf, changedSince, changedSincePick, recomputing }: PlanRailProps) {
  return (
    <section data-testid="advisor-plan" aria-label="Your next three turns" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className={`${MICRO_LABEL} text-text-faint`}>Your next {plan.turns.length === 1 ? "turn" : `${plan.turns.length} turns`}</span>
        <span data-testid="advisor-stamp" className="font-mono text-xs tabular-nums text-text-faint">
          As of {pickLabel(plan.computedAtPick, teamCount)} · {plan.runs} runs
        </span>
        {recomputing ? (
          <span data-testid="advisor-recomputing" className={`${MICRO_LABEL} text-text-muted`}>
            Recomputing
          </span>
        ) : null}
      </div>
      {changedSince.length === 0 ? null : (
        <ul data-testid="advisor-changed" aria-label={changedSincePick === null ? "Changed since your last look" : `Changed since ${pickLabel(changedSincePick, teamCount)}`} className="flex flex-col gap-0.5">
          {changedSince.map((line) => (
            <li key={line} className="text-xs text-text-muted">
              {line}
            </li>
          ))}
        </ul>
      )}
      {plan.turns.length === 0 ? (
        <p className="text-sm text-text-faint">You have no turn left to plan for.</p>
      ) : (
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {plan.turns.map((turn) => (
            <li key={turn.turn} data-testid="advisor-plan-turn" className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className={`${MICRO_LABEL} text-text-faint`}>Turn {turn.turn}</span>
                <span className="font-display text-sm font-bold tabular-nums text-text-primary">{pickLabel(turn.pickNumber, teamCount)}</span>
                <PositionBadge position={turn.position} size="sm" />
              </div>
              <ul className="flex flex-col gap-1">
                {turn.targets.map((target) => (
                  <TargetRow key={target.playerId} target={target} turn={turn} plan={plan} teamCount={teamCount} nameOf={nameOf} />
                ))}
              </ul>
              <p data-testid="advisor-plan-fallback" className="text-xs text-text-faint">
                {turn.fallback === null ? "No safe fallback at this position." : `If they go: ${nameOf(turn.fallback.playerId)}.`}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
