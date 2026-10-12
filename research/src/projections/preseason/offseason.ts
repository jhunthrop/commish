import type { Position } from "@research/domain/player";
import {
  redistributeShares,
  type RosterPlayer,
  type ShareDelta,
  type ShareMove,
} from "../features/redistribution";

/**
 * THE OFFSEASON DELTA — in August the signal is almost entirely CHANGE.
 *
 * A player on the same team in the same role with the same play-caller is a prior: last season is
 * evidence about this one and layer 1 already knows how to weigh it. Everybody else needs adjusting,
 * and the adjustments are the only thing on a preseason board that a projection of last season's
 * numbers does not already contain.
 *
 * THIS FILE WRITES NO REDISTRIBUTION LOGIC. `features/redistribution.ts` already decides who absorbs
 * a vacated share and by how much; `features/scheme.ts` already decides what a new play-caller does
 * to an offence's pace and pass rate, and `contextualiseOpportunity` already applies it. What was
 * missing was never the arithmetic — it was the LOG. Model v2 said so in as many words: "Where this
 * would pay: a transaction wire, not better arithmetic. Every number above is bounded by the fact
 * that this engine learns of a trade one Sunday late." A week-one roster IS that wire, arriving
 * before the season instead of a Sunday after it, and this module is the adapter between the two.
 *
 * WHY THE PHASE 3 RESULT DOES NOT PREDICT THIS ONE. Redistribution measured as not earning its place
 * in season, and the diagnosis was that layer 1's shrinkage already did the job: a departed player
 * stops appearing in the usage history and his teammates' recency-weighted shares rise on their own
 * within a game or two. Preseason is a different test, because there is no in-season usage to shrink
 * toward — every share a board projects comes from a season in which the departed player was still
 * there. So the mechanism Phase 3 found doing the work is absent by construction, and the feature is
 * measured here on its own terms rather than assumed to inherit either verdict.
 */

/** One player's change of employer across an offseason, with the work he took with him. */
export interface OffseasonMove {
  readonly playerId: string;
  readonly position: Position;
  /** His team at the end of last season, or null if he was not in the league. */
  readonly from: string | null;
  /** His team on this season's week-one roster, or null if nobody rostered him. */
  readonly to: string | null;
  /** The share he held with `from` last season. Positive in both directions, as `ShareMove` is. */
  readonly targetShare: number;
  readonly carryShare: number;
}

export interface OffseasonInput {
  /** Every move across the offseason, in any order. Players who did not move may be included. */
  readonly moves: readonly OffseasonMove[];
  /** Each team's returning roster: everyone whose `to` is that team and who did not leave it. */
  readonly rosters: ReadonlyMap<string, readonly RosterPlayer[]>;
  /** From the fitted redistribution priors. Never 1: some vacated work simply stops happening. */
  readonly absorptionRate: number;
}

/** A move that changed anything. Someone who stayed put is not a transaction. */
export function isTransaction(move: OffseasonMove): boolean {
  return move.from !== move.to;
}

/**
 * Which team a move is a DEPARTURE from and which it is an ARRIVAL at.
 *
 * A player who left the league entirely (`to` is null) is a departure from his old team and an
 * arrival nowhere, which is correct: his share vacates and nobody carries it in. A rookie or a
 * returning player (`from` is null) is an arrival with a zero share, which contributes nothing here
 * and is `rookies.ts`' problem instead. Naming both cases rather than filtering them out is what
 * keeps the two modules from silently double-counting the same man.
 */
function movesByTeam(moves: readonly OffseasonMove[]): ReadonlyMap<string, { departures: ShareMove[]; arrivals: ShareMove[] }> {
  const byTeam = new Map<string, { departures: ShareMove[]; arrivals: ShareMove[] }>();
  const ensure = (team: string): { departures: ShareMove[]; arrivals: ShareMove[] } => {
    const existing = byTeam.get(team);
    if (existing !== undefined) return existing;
    const created = { departures: [] as ShareMove[], arrivals: [] as ShareMove[] };
    byTeam.set(team, created);
    return created;
  };

  for (const move of moves) {
    if (!isTransaction(move)) continue;
    const share: ShareMove = {
      playerId: move.playerId,
      position: move.position,
      targetShare: move.targetShare,
      carryShare: move.carryShare,
    };
    // A move with no share attached moves nothing, whichever direction it points. Keeping it would
    // put a zero-weight entry through the absorption weights for no effect and make the log harder
    // to read when something does go wrong.
    if (share.targetShare <= 0 && share.carryShare <= 0) continue;
    if (move.from !== null) ensure(move.from).departures.push(share);
    if (move.to !== null) ensure(move.to).arrivals.push(share);
  }
  return byTeam;
}

/**
 * Every returning player's share delta, from every offseason move at once.
 *
 * One call to `redistributeShares` per team, with that team's departures and arrivals accumulated
 * together, so a club that lost one receiver and signed another nets out rather than being moved
 * twice. That netting is the commonest shape a real offseason takes and it is exactly what
 * `redistributeShares` was built to get right, which is why this composes it instead of looping.
 */
export function offseasonDeltas({ moves, rosters, absorptionRate }: OffseasonInput): ReadonlyMap<string, ShareDelta> {
  const deltas = new Map<string, ShareDelta>();
  for (const [team, { departures, arrivals }] of movesByTeam(moves)) {
    const roster = rosters.get(team);
    if (roster === undefined || roster.length === 0) continue;
    for (const [playerId, delta] of redistributeShares({ roster, departures, arrivals, absorptionRate })) {
      deltas.set(playerId, delta);
    }
  }
  return deltas;
}

/**
 * The players whose situation changed, which is the SEGMENT this feature is judged on.
 *
 * Phase 3's own instruction, restated in this phase's plan: "Every task ablates on the segment it
 * targets. Redistribution will not move the overall number; judge it on players whose situation
 * changed." A player is in the segment if he moved, or if a teammate of his did — the second half
 * matters more than the first, because the receiver who inherits a departed man's targets is the
 * one the feature is supposed to be right about.
 */
export function changedSituationSegment(
  moves: readonly OffseasonMove[],
  rosters: ReadonlyMap<string, readonly RosterPlayer[]>,
): ReadonlySet<string> {
  const segment = new Set<string>();
  const touchedTeams = new Set<string>();
  for (const move of moves) {
    if (!isTransaction(move)) continue;
    if (move.targetShare <= 0 && move.carryShare <= 0) continue;
    segment.add(move.playerId);
    if (move.from !== null) touchedTeams.add(move.from);
    if (move.to !== null) touchedTeams.add(move.to);
  }
  for (const team of touchedTeams) {
    for (const player of rosters.get(team) ?? []) segment.add(player.playerId);
  }
  return segment;
}
