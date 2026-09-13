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
import type { DraftPoolEntry } from "@/domain/draft";
import { restrictedPositions } from "@/domain/roster-eligibility";
import { assignSlot, autopickEligible, availablePool, draftedPlayerIds, rosterFor, snakeTeamForPick, teamOnClock, totalPickCount, type DraftState } from "@/draft-engine";
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
 *  call already built. A picked player absent from the evidence pool keeps his seat and his
 *  position (the pool's own) at zero value, never a made-up one: the roster's counts against the
 *  ceilings must be the roster's (review fix round, M4), so an unvalued QB1 still makes the next
 *  quarterback the second. */
function rosterSoFar(state: DraftState, askingTeamId: string, valued: ReadonlyMap<string, ValuedEntry>): readonly RosteredPlayer[] {
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  return state.picks
    .filter((pick) => pick.teamId === askingTeamId)
    .sort((a, b) => a.pickNumber - b.pickNumber)
    .flatMap((pick) => {
      const entry = valued.get(pick.playerId);
      if (entry !== undefined) return [{ playerId: pick.playerId, position: entry.position, valueOverReplacement: entry.valueOverReplacement }];
      const position = positionOf.get(pick.playerId);
      return position === undefined ? [] : [{ playerId: pick.playerId, position, valueOverReplacement: 0 }];
    });
}

export interface RecommendInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly shape: LeagueShape;
  /** How many to rank. Default `ADVISOR_CONFIG.shortlistSize`. */
  readonly shortlistSize?: number;
}

/**
 * THE BOARD-ORDER SHORTLIST, for a seat the valued board cannot serve (the 2026-09-12 round,
 * founder report 3). The evidence board carries no kicker or team defence (the K and D/ST
 * market-order ruling of 2026-09-05 ships them unprojected), so once a roster's bench was full
 * and only those slots remained, `recommendPick` had nobody to rank: the card went dark, the
 * dock fell back to the best skill player left, and the room refused him. The seat's shortlist
 * is then whatever it can still take, in the room's own board order (the market's, which is the
 * order the clock would take them in too), each named as the slot he fills. When the bench is
 * open (`restrictedPositions` null) anything legal qualifies; nothing legal, nothing named.
 */
function boardOrderShortlist(state: DraftState, askingTeamId: string, shortlistSize: number): readonly Recommendation[] {
  const roster = rosterFor(state, askingTeamId);
  const slotConfig = state.config.slotConfig;
  const owed = restrictedPositions(slotConfig, roster);
  const fits = (entry: DraftPoolEntry): boolean => (owed === null || owed.includes(entry.position)) && assignSlot({ position: entry.position, roster, slotConfig }).ok;
  return availablePool(state)
    .filter((entry) => autopickEligible(entry) && fits(entry))
    .slice(0, shortlistSize)
    .map((entry) => {
      const assignment = assignSlot({ position: entry.position, roster, slotConfig });
      return {
        playerId: entry.playerId,
        position: entry.position,
        expectedValueAdded: 0,
        valueOverReplacement: 0,
        rosterAdjustedValue: 0,
        survivalProbability: 0,
        reasons: assignment.ok ? [{ code: "fills_starting_slot", slot: assignment.slot }] : [],
      };
    });
}

/** The seat's shortlist for its current-or-next decision, best first; empty when the seat has no
 *  turn left to decide. The valued board's own ranking, or the board-order shortlist when the
 *  valued board has nobody the roster can take. */
export function recommendNow({ state, askingTeamId, valued, shape, shortlistSize = ADVISOR_CONFIG.shortlistSize }: RecommendInput): readonly Recommendation[] {
  const window = askingWindow(state, askingTeamId);
  if (window === null) return [];
  const drafted = draftedPlayerIds(state);
  const ranked = recommendPick({
    board: [...valued.values()].filter((entry) => !drafted.has(entry.playerId)),
    roster: rosterSoFar(state, askingTeamId, valued),
    shape,
    pickNumber: window.pickNumber,
    nextPickNumber: window.nextPickNumber,
    shortlistSize,
  });
  return ranked.length > 0 ? ranked : boardOrderShortlist(state, askingTeamId, shortlistSize);
}

/** The on-clock seat's own shortlist, held off its current pick in every run (ruling R-3, see
 *  `sim/continue.ts`). Empty when nobody is on the clock. */
export function onClockShortlist(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>, shape: LeagueShape): ReadonlySet<string> {
  const onClock = teamOnClock(state);
  if (onClock === null) return new Set();
  return new Set(recommendNow({ state, askingTeamId: onClock, valued, shape }).map((rec) => rec.playerId));
}
