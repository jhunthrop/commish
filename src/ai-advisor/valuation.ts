import type { Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import { roundPoints } from "@/scoring";
import { ADVISOR_CONFIG } from "./config";

export interface ValuedPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  /** Points per week under THIS league's scoring settings. The only currency here. */
  readonly averagePoints: number;
}

export type TradeVerdict = "even" | "favors_proposer" | "favors_receiver" | "lopsided";

/**
 * Machine-readable reasons, not prose. A later collusion sweep escalates on these; an advisor
 * turns them into a sentence. Both read the same list.
 */
export type TradeFlag = "empty_side" | "uneven_player_count" | "value_gap_over_threshold";

export interface TradeBalance {
  /** What the proposer gives up, per week. */
  readonly givingValue: number;
  /** What the proposer gets back, per week. */
  readonly receivingValue: number;
  /** `givingValue - receivingValue`. Positive means the proposer is sending more value out. */
  readonly delta: number;
  readonly verdict: TradeVerdict;
  readonly flags: readonly TradeFlag[];
}

function total(players: readonly ValuedPlayer[]): number {
  return roundPoints(players.reduce((sum, player) => sum + player.averagePoints, 0));
}

/**
 * The fairness verdict — **the platform's trade-fairness detector, not an advisor helper.**
 *
 * It takes two valued sides and nothing else: no user, no question, no league, no model. That
 * is deliberate (strategy doc §4.1). A later automated collusion sweep runs this over every
 * proposed trade with system-supplied valuations and gets the identical verdict and flags a
 * manager was shown, so "what the advisor told you" and "what integrity flagged" can never be
 * two different opinions.
 *
 * The LLM never computes this. It writes prose about a verdict already decided here, which is
 * what makes the no-API-key path a complete answer rather than a stub — and keeps an integrity
 * decision out of a nondeterministic component.
 */
export function tradeBalance(giving: readonly ValuedPlayer[], receiving: readonly ValuedPlayer[]): TradeBalance {
  const givingValue = total(giving);
  const receivingValue = total(receiving);
  const delta = roundPoints(givingValue - receivingValue);
  const gap = Math.abs(delta);

  const flags: TradeFlag[] = [];
  if (giving.length === 0 || receiving.length === 0) flags.push("empty_side");
  if (giving.length !== receiving.length) flags.push("uneven_player_count");
  if (gap > ADVISOR_CONFIG.lopsidedDelta) flags.push("value_gap_over_threshold");

  // The verdict reuses the flag rather than re-testing the threshold — one rule, one spelling.
  const verdict: TradeVerdict =
    flags.includes("empty_side") || flags.includes("value_gap_over_threshold")
      ? "lopsided"
      : gap <= ADVISOR_CONFIG.evenDelta
        ? "even"
        : delta < 0
          ? "favors_proposer"
          : "favors_receiver";

  return { givingValue, receivingValue, delta, verdict, flags };
}

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
