/**
 * THE RECOMMENDATION UNDER THE CARD — what `recommendPick` (`@/projections/decide/draft`) would
 * take from the room's OWN replayed `DraftState` (ruling R-pf2: mid-draft, a manager's roster and
 * picks come from the REPLAYED live state, never from `draft_picks` rows, which do not exist until
 * the draft completes).
 *
 * VALUATION, COMPUTED ONCE OVER THE WHOLE EVIDENCE POOL, THROUGH ONE SHARED HELPER.
 * `valueBoardIndexed` (`@/projections/decide/replacement.ts`) runs once against every player
 * `evidencePoolFor` returns (drafted and undrafted alike) — the identical population
 * `@/draft-hq/board/service.ts`'s `boardRows` values the Board from. This is what lets a
 * ROSTERED player's own `valueOverReplacement` be computed at all — a player already off the
 * board cannot be re-valued from a population that excludes him. `RecommendationQuery.board` is
 * then every UNDRAFTED entry of that one valuation.
 */
import { draftedPlayerIds, snakeTeamForPick, teamOnClock, totalPickCount, type DraftState } from "@/draft-engine";
import { recommendPick, type Recommendation, type RosteredPlayer } from "@/projections/decide/draft";
import { valueBoardIndexed, type LeagueShape, type ValuedPlayer } from "@/projections/decide/replacement";
import type { SimPlayerEvidence } from "../sim/types";
import { ADVISOR_CONFIG } from "./config";

/** A valued evidence row, the market's own price attached — exactly `DraftCandidate`'s shape,
 *  kept under its own name here because this module also reuses it to price a ROSTERED player
 *  (who is deliberately excluded from `DraftCandidate`'s own "undrafted" population). */
export interface ValuedEntry extends ValuedPlayer {
  readonly averageDraftPosition: number;
}

/** Every evidence player, valued once under `shape`. `averageDraftPosition` is the market's own
 *  rank when the ADP feed carries one, falling back to this valuation's OWN rank otherwise: "any
 *  consistent market will do" is `BoardEntry`'s own docblock, and a rank is a consistent market.
 *  The fallback is the value rank rather than a rank by raw points, which is the ordering that
 *  put quarterbacks on top of the Simulator (founder, 2026-09-05). */
export function valuedEvidence(pool: readonly SimPlayerEvidence[], shape: LeagueShape): ReadonlyMap<string, ValuedEntry> {
  const { sorted, byPlayerId } = valueBoardIndexed(pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })), shape);
  const valueRankByPlayerId = new Map(sorted.map((entry, index) => [entry.playerId, index] as const));
  const marketByPlayerId = new Map(pool.map((entry) => [entry.playerId, entry.marketRank] as const));
  return new Map(
    [...byPlayerId].map(([playerId, entry]) => [playerId, { ...entry, averageDraftPosition: marketByPlayerId.get(playerId) ?? valueRankByPlayerId.get(playerId)! }]),
  );
}

export interface AskingWindow {
  /** The asking seat's own current-or-next decision — `state.pickNumber` only when the asking
   *  seat is the one actually on the clock right now. */
  readonly pickNumber: number;
  /** The turn after that, or null when `pickNumber` is the asking seat's forced last pick. */
  readonly nextPickNumber: number | null;
}

/** Scans forward from the draft's current pick for the asking seat's own next two turns. Null
 *  only defensively: an `in_progress` draft's own draft order always owes every seat at least one
 *  more pick from `state.pickNumber` onward, by `totalPickCount`'s own construction. */
export function askingWindow(state: DraftState, askingTeamId: string): AskingWindow | null {
  const lastPick = totalPickCount(state);
  let pickNumber: number | null = null;
  let nextPickNumber: number | null = null;
  for (let pick = state.pickNumber; pick <= lastPick; pick += 1) {
    if (snakeTeamForPick(state.draftOrder, pick) !== askingTeamId) continue;
    if (pickNumber === null) {
      pickNumber = pick;
      continue;
    }
    nextPickNumber = pick;
    break;
  }
  return pickNumber === null ? null : { pickNumber, nextPickNumber };
}

/** The asking seat's own committed picks, in draft order, priced through the one valuation this
 *  call already built. A picked player absent from the evidence pool is left out rather than
 *  priced at a made-up value. */
function rosterSoFar(state: DraftState, askingTeamId: string, valued: ReadonlyMap<string, ValuedEntry>): readonly RosteredPlayer[] {
  return state.picks
    .filter((pick) => pick.teamId === askingTeamId)
    .sort((a, b) => a.pickNumber - b.pickNumber)
    .flatMap((pick) => {
      const entry = valued.get(pick.playerId);
      return entry === undefined ? [] : [{ playerId: pick.playerId, position: entry.position, valueOverReplacement: entry.valueOverReplacement }];
    });
}

export interface RecommendInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly shape: LeagueShape;
}

/** The seat's shortlist for its current-or-next decision, best first; empty when the seat has no
 *  turn left to decide. */
export function recommendNow({ state, askingTeamId, valued, shape }: RecommendInput): readonly Recommendation[] {
  const window = askingWindow(state, askingTeamId);
  if (window === null) return [];
  const drafted = draftedPlayerIds(state);
  return recommendPick({
    board: [...valued.values()].filter((entry) => !drafted.has(entry.playerId)),
    roster: rosterSoFar(state, askingTeamId, valued),
    shape,
    pickNumber: window.pickNumber,
    nextPickNumber: window.nextPickNumber,
    shortlistSize: ADVISOR_CONFIG.shortlistSize,
  });
}

/** The on-clock seat's own shortlist, held off its current pick in every run (ruling R-3, see
 *  `sim/continue.ts`). Empty when nobody is on the clock. */
export function onClockShortlist(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>, shape: LeagueShape): ReadonlySet<string> {
  const onClock = teamOnClock(state);
  if (onClock === null) return new Set();
  return new Set(recommendNow({ state, askingTeamId: onClock, valued, shape }).map((rec) => rec.playerId));
}
