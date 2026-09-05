/**
 * THE CALL — Draft HQ's live-room Assistant, one honest read of "what would you do right now (or
 * at your very next turn)": the top three players `recommendPick` (`@/projections/decide/draft`)
 * would take from the room's OWN replayed `DraftState` — the same state-load seam
 * `GET /api/drafts/[draftId]` uses (ruling R-pf2: mid-draft, a manager's roster and picks come
 * from the REPLAYED live state, never from `draft_picks` rows, which do not exist until the draft
 * completes) — each carrying a live `makeItBackOdds` row (Task 2, `sim/make-it-back.ts`)
 * measuring whether he will still be undrafted the next time the asking seat is on the clock.
 *
 * MEMBERSHIP AND SEAT, ONE CONDITION. `resolveDraftActor` (the same authorization primitive every
 * `/api/drafts/[draftId]/**` route already resolves through) answers "not a member" and "a
 * commissioner with no team of their own" with the identical fact: `actor.teamId === null`. The
 * Assistant has nothing to say to either — there is no seat's turn to advise — so one guard
 * answers both, exactly as this function's own contract states.
 *
 * VALUATION, COMPUTED ONCE OVER THE WHOLE EVIDENCE POOL, THROUGH ONE SHARED HELPER.
 * `valueBoardIndexed` (`@/projections/decide/replacement.ts`) runs once against every player
 * `evidencePoolFor` returns (drafted and undrafted alike) — the identical population
 * `@/draft-hq/board/service.ts`'s `boardRows` values the Board from (both now read their own
 * valuation through this one helper, rather than each hand-rolling `new Map(valueBoard(...))`),
 * and the identical PATTERN `@/projections/decide/replay.ts`'s own harness uses (one valuation
 * call up front, `board` re-filtered to what remains undrafted at each turn). This is what lets a
 * ROSTERED player's own `valueOverReplacement` (`RosteredPlayer`'s docblock: required, never
 * defaulted) be computed at all — a player already off the board cannot be re-valued from a
 * population that excludes him. `RecommendationQuery.board` itself is then every UNDRAFTED entry
 * of that one valuation.
 *
 * SEEDING. `${draftId}:${pickNumber}` hashed the same way `sim/store.ts`'s `hashSimConfig` hashes
 * a config — a small local helper rather than a shared one, because this hash's input shape
 * (a draft id and a pick number) has nothing in common with a `SimConfig`'s. Same pick, same
 * seed, same odds: a refetch never flickers.
 *
 * WINNING BUILDS, LOOKED UP, NEVER COMPUTED. `winningBuilds` reads `findCachedRun` directly for
 * the CANONICAL sim `@/draft-hq/playbook/service.ts`'s `canonicalSimFor` would have triggered for
 * this league and seat (same rounds, runs and sharpness; `deriveSeed`, exported from
 * `sim/service.ts` for exactly this reuse, reconstructs the identical seed so the configHash
 * matches without a second formula that could drift). Unlike `canonicalSimFor`, this NEVER
 * triggers a sim run: a live pick clock is not the place to pay for one, and "the user has not
 * run a sim for this league yet" is an honest `null`, never a fabricated build list.
 *
 * `assistantCallCore` (Task 12) IS the whole of the above minus the two DB reads
 * (`evidencePoolFor`, `findCachedRun`) and the membership guard — a pure function of an already-
 * valued board and a `DraftState`, exported so the Assistant demo page
 * (`@/draft-hq/assistant-demo/fixture.ts`) can compute a REAL `AssistantCallView` over a headless
 * replayed room without a database, rather than a second, drifting reimplementation of "what the
 * call actually is." `assistantCall` itself is now nothing but the DB plumbing plus one call into
 * this core.
 */
import { createHash } from "node:crypto";
import type { Db } from "@/db/client";
import type { Position } from "@/domain/player";
import { draftedPlayerIds, snakeTeamForPick, teamOnClock, totalPickCount, totalRosterSlots, type DraftState } from "@/draft-engine";
import { getDraftStore, resolveDraftActor } from "@/draft-service";
import { recommendPick, type PickReason, type Recommendation, type RosteredPlayer } from "@/projections/decide/draft";
import { valueBoardIndexed, type LeagueShape, type ValuedPlayer } from "@/projections/decide/replacement";
import { classifyBuild, type BuildLabel, type ClassifiablePick } from "../sim/classify";
import { evidencePoolFor } from "../sim/evidence";
import { makeItBackOdds, type MakeItBackOdds } from "../sim/make-it-back";
import { SIM_CONFIG, SIM_SHARPNESS } from "../sim/config";
import { deriveSeed } from "../sim/service";
import { findCachedRun, hashSimConfig } from "../sim/store";
import type { BuildOutcome, SimConfig, SimPlayerEvidence, SimSummary, StoredSimSummary } from "../sim/types";

export interface AssistantCandidate {
  readonly playerId: string;
  readonly position: Position;
  readonly reasons: readonly PickReason[];
  readonly makeItBack: MakeItBackOdds | null;
}

export interface AssistantCallView {
  readonly pickNumber: number;
  readonly onTheClock: boolean;
  readonly candidates: readonly AssistantCandidate[];
  readonly yourBuild: readonly BuildLabel[];
  readonly winningBuilds: readonly BuildOutcome[] | null;
  readonly computedBasis: string;
}

/** A valued evidence row, the market's own price attached — exactly `DraftCandidate`'s shape,
 *  kept under its own name here because this module also reuses it to price a ROSTERED player
 *  (who is deliberately excluded from `DraftCandidate`'s own "undrafted" population). Exported so
 *  a caller building its own valued board (the Assistant demo's synthetic evidence pool, never a
 *  DB read) can hand `assistantCallCore` the exact shape it expects. */
export interface ValuedEntry extends ValuedPlayer {
  readonly averageDraftPosition: number;
}

/** `${seedNamespace}:${pickNumber}` hashed the same way `sim/store.ts`'s `hashSimConfig` hashes a
 *  config. `seedNamespace` is a draft id for a real room; the demo fixture hands its own fixed
 *  namespace instead, which is all this function actually needs — a string that never repeats
 *  across two different "rooms" being seeded. Same pick, same seed, same odds: a refetch never
 *  flickers, and a demo step never reshuffles on a re-render. */
function seedFor(seedNamespace: string, pickNumber: number): number {
  const hex = createHash("sha256").update(`${seedNamespace}:${pickNumber}`).digest("hex").slice(0, 8);
  return parseInt(hex, 16);
}

/** Every evidence player, valued once under `shape` through the SAME `valueBoardIndexed` wiring
 *  `@/draft-hq/board/service.ts`'s `boardRows` reads its own valuation through — one shared helper
 *  rather than two hand-rolled `new Map(valueBoard(...).map(...))`s. `averageDraftPosition` is the
 *  market's own rank when the ADP feed carries one, falling back to the evidence board's own rank
 *  otherwise (the identical fallback `sim/board-order.ts`'s `baseBlendRank` already uses): "any
 *  consistent market will do" is `BoardEntry`'s own docblock, and a rank is a consistent market. */
function valuedEvidence(pool: readonly SimPlayerEvidence[], shape: LeagueShape): ReadonlyMap<string, ValuedEntry> {
  const { byPlayerId } = valueBoardIndexed(pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })), shape);
  const marketByPlayerId = new Map(pool.map((entry) => [entry.playerId, entry.marketRank ?? entry.evidenceRank] as const));
  return new Map([...byPlayerId].map(([playerId, entry]) => [playerId, { ...entry, averageDraftPosition: marketByPlayerId.get(playerId)! }]));
}

interface AskingWindow {
  /** The asking seat's own current-or-next decision — `state.pickNumber` only when the asking
   *  seat is the one actually on the clock right now. */
  readonly pickNumber: number;
  /** The turn after that, or null when `pickNumber` is the asking seat's forced last pick. */
  readonly nextPickNumber: number | null;
}

/** Scans forward from the draft's current pick for the asking seat's own next two turns. Null
 *  only defensively: an `in_progress` draft's own draft order always owes every seat at least one
 *  more pick from `state.pickNumber` onward, by `totalPickCount`'s own construction. */
function askingWindow(state: DraftState, askingTeamId: string): AskingWindow | null {
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
 *  call already built. A picked player absent from the evidence pool (never happens in practice —
 *  a live room's pool is itself sourced from the same evidence board — kept as a defensive skip
 *  rather than a crash) is left out rather than priced at a made-up value. */
function rosterSoFar(state: DraftState, askingTeamId: string, valued: ReadonlyMap<string, ValuedEntry>): readonly RosteredPlayer[] {
  return state.picks
    .filter((pick) => pick.teamId === askingTeamId)
    .sort((a, b) => a.pickNumber - b.pickNumber)
    .flatMap((pick) => {
      const entry = valued.get(pick.playerId);
      return entry === undefined ? [] : [{ playerId: pick.playerId, position: entry.position, valueOverReplacement: entry.valueOverReplacement }];
    });
}

/** The asking seat's own picks, as `classifyBuild` needs to see them — position read off the
 *  draft's own pool (every drafted player is a pool member by construction), never off the
 *  evidence valuation, so a build classification never depends on the evidence board having kept
 *  up with a player long since drafted. */
function classifiablePicks(state: DraftState, askingTeamId: string): readonly ClassifiablePick[] {
  const positionByPlayerId = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  return state.picks
    .filter((pick) => pick.teamId === askingTeamId)
    .map((pick) => ({ round: pick.round, position: positionByPlayerId.get(pick.playerId)! }));
}

/** The shortlist's own live odds, one `makeItBackOdds` call for all three at once (Task 2's own
 *  ruling: never one call per candidate). Skipped entirely when there is no next turn to measure —
 *  every candidate's `makeItBack` is then null by construction, never a fabricated "certain" or
 *  "impossible" row for a question that does not apply. A row whose own `survival` came back null
 *  (every seeded run ended before the asking seat's next turn) collapses to null here too — see
 *  `AssistantCandidate.makeItBack`'s own contract. */
function candidatesWithOdds(state: DraftState, askingTeamId: string, recommendations: readonly Recommendation[], nextPickNumber: number | null, seed: number): readonly AssistantCandidate[] {
  const shortlistIds = recommendations.map((rec) => rec.playerId);
  const odds = nextPickNumber === null || shortlistIds.length === 0 ? [] : makeItBackOdds({ state, askingTeamId, shortlistIds, seed });
  const oddsByPlayerId = new Map(odds.map((row) => [row.playerId, row] as const));
  return recommendations.map((rec) => {
    const row = oddsByPlayerId.get(rec.playerId) ?? null;
    return {
      playerId: rec.playerId,
      position: rec.position,
      reasons: rec.reasons,
      makeItBack: row === null || row.survival === null ? null : row,
    };
  });
}

function summaryForSlot(summary: StoredSimSummary, slot: number): SimSummary | null {
  return "bySlot" in summary ? (summary.bySlot.find((entry) => entry.slot === slot) ?? null) : summary;
}

/** `findCachedRun` alone — never `requestSimRun` — so a live pick clock can never be made to wait
 *  on (or pay for) a sim nobody has asked for yet. See the module docblock for why the config
 *  reconstructed here is the exact one `canonicalSimFor` would have used. */
async function winningBuildsFor(db: Db, userId: string, leagueId: string, shape: LeagueShape, slot: number, boardGeneration: string): Promise<readonly BuildOutcome[] | null> {
  const knobs = { slot, rounds: totalRosterSlots(shape.rosterSlots), runs: SIM_CONFIG.syncRunThreshold, sharpness: SIM_SHARPNESS.mixed };
  const config: SimConfig = { teamCount: shape.teamCount, rosterSlots: shape.rosterSlots, ...knobs, seed: deriveSeed(shape, { leagueId, ...knobs }) };
  const cached = await findCachedRun(db, userId, hashSimConfig(config), boardGeneration);
  if (cached === null || cached.summary === null) return null;
  return summaryForSlot(cached.summary, slot)?.builds ?? null;
}

export interface AssistantCallCoreInput {
  /** A snake `DraftState` mid-draft — a real room's replayed state, or a headless sim's own. */
  readonly state: DraftState;
  readonly askingTeamId: string;
  /** Every player in this room's evidence pool, drafted and undrafted alike, valued once through
   *  `valueBoardIndexed` — a real room's `valuedEvidence(pool, shape)`, or the demo's own
   *  synthetic equivalent. See the module docblock: a rostered player's `valueOverReplacement`
   *  cannot be computed at all from a population that has already excluded him. */
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly shape: LeagueShape;
  /** Hashed with the asking pick number for the make-it-back seed (`seedFor`'s own docblock) — a
   *  real room's `draftId`, or the demo's own fixed namespace. */
  readonly seedNamespace: string;
  /** Looked up, never computed here — see the module docblock. `null` is the honest answer for
   *  a room (or a demo) with no cached sim run of its own. */
  readonly winningBuilds: readonly BuildOutcome[] | null;
  /** Stated provenance for the numbers below — a real room's evidence-board `asOf` stamp, or the
   *  demo's own "replayed, not live" label. Carried through rather than fixed to one shape,
   *  since a demo and a real room have two honestly different things to say here. */
  readonly computedBasis: string;
}

/**
 * THE CALL, MINUS THE TWO DB READS. Everything `assistantCall` does after it has a `DraftState`
 * and a valued board: the asking seat's own current-or-next decision window, the shortlist,
 * live make-it-back odds, this seat's build classification. `null` only when the asking seat has
 * no further turn left to advise (`askingWindow`'s own defensive case) — see the module docblock
 * for why this is the one function both the real Assistant and its replayed demo call.
 */
export function assistantCallCore(input: AssistantCallCoreInput): AssistantCallView | null {
  const { state, askingTeamId, valued, shape, seedNamespace, winningBuilds, computedBasis } = input;

  const window = askingWindow(state, askingTeamId);
  if (window === null) return null;

  const drafted = draftedPlayerIds(state);
  const board = [...valued.values()].filter((entry) => !drafted.has(entry.playerId));

  const recommendations = recommendPick({
    board,
    roster: rosterSoFar(state, askingTeamId, valued),
    shape,
    pickNumber: window.pickNumber,
    nextPickNumber: window.nextPickNumber,
    shortlistSize: 3,
  });
  const candidates = candidatesWithOdds(state, askingTeamId, recommendations, window.nextPickNumber, seedFor(seedNamespace, window.pickNumber));

  return {
    pickNumber: window.pickNumber,
    onTheClock: teamOnClock(state) === askingTeamId,
    candidates,
    yourBuild: classifyBuild(classifiablePicks(state, askingTeamId)),
    winningBuilds,
    computedBasis,
  };
}

/**
 * `null` when the caller is not a member of this draft's league, has no seat of their own to
 * advise (commissioner or not), or the draft is not currently `in_progress` — see the module
 * docblock and each guard's own comment for why.
 */
export async function assistantCall(db: Db, draftId: string, userId: string): Promise<AssistantCallView | null> {
  const actorResult = await resolveDraftActor(db, draftId, userId);
  if (!actorResult.ok) return null;
  const { actor } = actorResult;
  const teamId = actor.teamId;
  if (teamId === null) return null;

  const state = await getDraftStore().getDraftState(draftId);
  if (state === null || state.phase !== "in_progress") return null;

  // SHORT-CIRCUIT BEFORE EITHER REMAINING DB READ (review fix, Task 12). The extraction into
  // `assistantCallCore` moved this exact guard behind `evidencePoolFor`/`winningBuildsFor` —
  // a seat with no turn left to advise (the ORDINARY state of every seat during a draft's own
  // tail, once its roster is full) would otherwise pay for two Postgres reads on every poll,
  // at the highest-concurrency moment a room ever sees. `assistantCallCore` re-derives this
  // same window internally (a pure, in-memory scan — never I/O), so recomputing it here costs
  // nothing next to the DB round trips it now guards.
  if (askingWindow(state, teamId) === null) return null;

  const shape: LeagueShape = { teamCount: state.draftOrder.length, rosterSlots: state.config.slotConfig };
  const { pool, boardGeneration } = await evidencePoolFor(db);
  const valued = valuedEvidence(pool, shape);

  const slot = state.draftOrder.indexOf(teamId) + 1;
  const winningBuilds = await winningBuildsFor(db, userId, actor.leagueId, shape, slot, boardGeneration);

  return assistantCallCore({ state, askingTeamId: teamId, valued, shape, seedNamespace: draftId, winningBuilds, computedBasis: boardGeneration });
}
