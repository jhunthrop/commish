/**
 * THE OPPONENT MODEL — draft advisor round, spec 3.1a: "each opponent's archetype is inferred
 * from that seat's own picks so far (the archetype under which the observed picks were most
 * likely, given the board at each of their turns, with the neutral archetype as the prior until a
 * seat has made enough picks to separate them) ... A seat on autopick is driven by the autopick
 * policy itself ... A seat that has not picked yet stays on the neutral prior."
 *
 * ONE SAMPLER, ONE LIKELIHOOD. The likelihood of an observed pick under an archetype is that
 * pick's share of `botCandidateWeights` (`@/mock-draft/bots`) at the board as it stood when the
 * seat was on the clock — the exact distribution the bot brain draws from, never a second scoring
 * rule. The board at that turn is reconstructed from the room's own pick log (`shadowStateBefore`):
 * picks before that pick number, rosters rebuilt from them, no queue (a human's queue at that
 * moment is unknowable and the sampler would short-circuit on one).
 *
 * "ENOUGH PICKS TO SEPARATE THEM" is two thresholds, both named in `SEAT_MODEL_CONFIG`: a floor on
 * the pick count, and a log-likelihood edge the best brain must hold over the neutral one. Below
 * either the seat is the prior and the card says so (`basis: "prior"`).
 *
 * "ON AUTOPICK" is read from the only fact the engine records: the seat's most recent pick was
 * made by the clock (`CompletedPick.auto`). The engine carries no per-seat autopick toggle.
 */
import type { CompletedPick } from "@/draft-engine";
import type { DraftState } from "@/draft-engine";
import { BOT_ARCHETYPES, type BotArchetype } from "@/mock-draft/archetypes";
import { botCandidateWeights } from "@/mock-draft/bots";

export const SEAT_MODEL_CONFIG = {
  /** Fewer observed picks than this and the seat stays on the neutral prior. */
  minPicks: 2,
  /** The best brain's log-likelihood must beat the neutral brain's by at least this (ln 1.5:
   *  the observed picks were half again as likely under it) before the read leaves the prior. */
  minLogLikelihoodEdge: Math.log(1.5),
  /** The likelihood charged for a pick OUTSIDE the sampler's reach window (a human reaching
   *  deeper than any brain would) — small, never zero, so one reach cannot veto every brain. */
  outsideWindowLikelihood: 0.02,
} as const;

export type SeatBasis = "inferred" | "prior";

export type SeatDriver =
  | { readonly kind: "archetype"; readonly archetype: BotArchetype; readonly basis: SeatBasis; readonly picksObserved: number }
  | { readonly kind: "autopick"; readonly picksObserved: number };

export type SeatDrivers = Readonly<Record<string, SeatDriver>>;

export const NEUTRAL_ARCHETYPE: BotArchetype = (() => {
  const neutral = BOT_ARCHETYPES.find((archetype) => archetype.name === "best_available");
  if (neutral === undefined) throw new Error("seat-model: BOT_ARCHETYPES no longer has a best_available entry");
  return neutral;
})();

function picksInOrder(state: DraftState): readonly CompletedPick[] {
  return [...state.picks].sort((a, b) => a.pickNumber - b.pickNumber);
}

/** The room as it stood the instant before `pickNumber` was made, rebuilt from the pick log. */
function shadowStateBefore(state: DraftState, ordered: readonly CompletedPick[], pickNumber: number): DraftState {
  const before = ordered.filter((pick) => pick.pickNumber < pickNumber);
  const rosters: Record<string, { slot: CompletedPick["slot"]; slotIndex: number; playerId: string }[]> = {};
  for (const pick of before) {
    rosters[pick.teamId] = [...(rosters[pick.teamId] ?? []), { slot: pick.slot, slotIndex: pick.slotIndex, playerId: pick.playerId }];
  }
  return { ...state, picks: before, rosters, queues: {}, owedPicks: {}, pickNumber };
}

/** ln P(observed pick | archetype) at one turn — see the module docblock. */
function pickLogLikelihood(shadow: DraftState, teamId: string, playerId: string, archetype: BotArchetype): number {
  const weights = botCandidateWeights(shadow, teamId, archetype);
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  const own = weights.find((row) => row.playerId === playerId);
  if (own === undefined || total <= 0) return Math.log(SEAT_MODEL_CONFIG.outsideWindowLikelihood);
  return Math.log(own.weight / total);
}

function logLikelihoodOf(state: DraftState, ordered: readonly CompletedPick[], teamId: string, own: readonly CompletedPick[], archetype: BotArchetype): number {
  return own.reduce((sum, pick) => sum + pickLogLikelihood(shadowStateBefore(state, ordered, pick.pickNumber), teamId, pick.playerId, archetype), 0);
}

/** The one seat's driver. Pure over the state; see the module docblock for each branch. */
export function inferSeatDriver(state: DraftState, teamId: string): SeatDriver {
  const ordered = picksInOrder(state);
  const own = ordered.filter((pick) => pick.teamId === teamId);
  const picksObserved = own.length;
  const latest = own[own.length - 1];
  if (latest !== undefined && latest.auto) return { kind: "autopick", picksObserved };
  if (picksObserved < SEAT_MODEL_CONFIG.minPicks) return { kind: "archetype", archetype: NEUTRAL_ARCHETYPE, basis: "prior", picksObserved };

  const scored = BOT_ARCHETYPES.map((archetype) => ({ archetype, logLikelihood: logLikelihoodOf(state, ordered, teamId, own, archetype) }));
  const neutral = scored.find((entry) => entry.archetype === NEUTRAL_ARCHETYPE)!;
  // Strict `>` and array order: a tie keeps the earlier deck entry, which is the neutral one.
  const best = scored.reduce((top, entry) => (entry.logLikelihood > top.logLikelihood ? entry : top), scored[0]!);
  const separated = best.archetype !== NEUTRAL_ARCHETYPE && best.logLikelihood - neutral.logLikelihood >= SEAT_MODEL_CONFIG.minLogLikelihoodEdge;
  return separated
    ? { kind: "archetype", archetype: best.archetype, basis: "inferred", picksObserved }
    : { kind: "archetype", archetype: NEUTRAL_ARCHETYPE, basis: "prior", picksObserved };
}

/** Every seat in the draft order, each read from its own picks. */
export function inferSeatDrivers(state: DraftState): SeatDrivers {
  return Object.fromEntries(state.draftOrder.map((teamId) => [teamId, inferSeatDriver(state, teamId)] as const));
}
