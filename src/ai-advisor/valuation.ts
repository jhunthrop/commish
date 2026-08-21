import type { RosterSlotType } from "@/domain/roster";
import type { ValuedPlayer } from "@/trades/fairness";

/**
 * `tradeBalance` and its types moved to `@/trades/fairness` in Phase 3 Plan C: `src/trades` is
 * pure, coverage-gated and browser-safe, and `src/ai-advisor` is none of those three. Re-exported
 * here so every existing consumer of `@/ai-advisor/valuation` keeps a zero diff, and `tradeBalance`
 * is still one function object rather than two that happen to agree — see
 * `src/trades/fairness.test.ts`'s identity assertion.
 */
export { tradeBalance, type ValuedPlayer, type TradeVerdict, type TradeFlag, type TradeBalance } from "@/trades/fairness";

export interface StartSitCandidate extends ValuedPlayer {
  readonly slot: RosterSlotType;
  readonly starting: boolean;
}

export interface StartSitBaseline {
  readonly start: readonly StartSitCandidate[];
  readonly sit: readonly StartSitCandidate[];
  /** True when the baseline disagrees with what is currently started. */
  readonly changed: boolean;
}

/**
 * The recommendation that is ALWAYS available, with or without a model — the same role
 * `staticNudge` plays for the draft moderator. Start the highest per-week scorers for exactly
 * as many spots as are currently started: it never invents a slot, never benches somebody to
 * an illegal lineup, and is computed from the league's own scoring settings, so it is already
 * league-specific before a single token is spent.
 */
export function baselineStartSit(candidates: readonly StartSitCandidate[]): StartSitBaseline {
  // playerId tiebreak: determinism by explicit key, not by trusting sort stability.
  const ranked = [...candidates].sort(
    (a, b) => b.averagePoints - a.averagePoints || a.playerId.localeCompare(b.playerId),
  );
  const startingCount = candidates.filter((candidate) => candidate.starting).length;
  const start = ranked.slice(0, startingCount);
  const sit = ranked.slice(startingCount);
  const changed = start.some((candidate) => !candidate.starting);
  return { start, sit, changed };
}
