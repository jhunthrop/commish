/**
 * THE ASSISTANT DEMO'S OWN FIXTURE — Task 12. A headless, deterministic 10-team draft
 * (`runOneDraft`, `@/draft-service/sim/run`, the same real engine every mock room and Simulator
 * run rides), replayed pick by pick, with a REAL `AssistantCallView` (`assistantCallCore`,
 * `@/draft-service/assistant/call`) precomputed at every step for the demo's own point-of-view
 * seat. No database, no gateway, no network: every player, projection and NFL team code below is
 * synthetic (labelled as such — `"RB 4"`, never a real athlete's name), but every NUMBER the
 * fixture hands the page is the real output of the real decision layer running over that
 * synthetic board — `recommendPick`, `valueBoardIndexed`, `makeItBackOdds` and `classifyBuild`
 * are called here exactly as `assistantCallCore` calls them for a live room. Nothing here
 * invents a make-it-back percentage or a tier-cliff number; the fixture only invents the PLAYERS
 * the real math then runs over.
 *
 * COMPUTED ONCE, AT MODULE SCOPE. `ASSISTANT_DEMO_FIXTURE` below is the module's only export
 * besides its own types — built the moment this module is first imported (the server page's own
 * import, `assistant-demo/page.tsx`), never rebuilt per request. It is plain, JSON-safe data
 * (arrays and objects, no `Map`/`Set`) precisely so it can cross the server-to-client-component
 * boundary as an ordinary prop, exactly like every other Draft HQ page hands its client
 * component plain numbers rather than a live store.
 *
 * WHY A SECOND HEADLESS-REPLAY LOOP, NOT A THIRD `runOneDraft` CALL. `runOneDraft` (and
 * `continueDraft`'s own docblock, the sibling primitive) already explains why a fresh loop over
 * `submit`/`admitCommand` is the sanctioned way to reuse the real engine's legality without a
 * second implementation of it: this file needs every INTERMEDIATE `DraftState`, not just the
 * final rosters `runOneDraft` returns, because `assistantCallCore` needs a real mid-draft state
 * at every step. Rather than re-deriving the bot brain's own pick sequence a second time (a real
 * risk of drift from `runOneDraft`'s own seeded stream), this replays the EXACT picks
 * `runOneDraft` already produced, one real `MAKE_PICK` at a time, through the same exported
 * `submit` helper `run.ts` and `continue.ts` both already use.
 */
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { initialDraftState, type DraftConfig, type DraftState } from "@/draft-engine";
import { assistantCallCore, type AssistantCallView, type ValuedEntry } from "@/draft-service/assistant/call";
import { classifyBuild, type ClassifiablePick } from "@/draft-service/sim/classify";
import { runOneDraft, submit, SIM_INSTANT } from "@/draft-service/sim/run";
import { valueBoardIndexed, type LeagueShape } from "@/projections/decide/replacement";
import { tierStanding } from "@/projections/decide/tiers";

/** Ten teams (the outer brief's own choice), four rounds — enough to show a run, a tier cliff, a
 *  bye collision and this seat's own build classification without paying for (or asking a reader
 *  to click through) a full 15-round bench-and-kicker draft. */
export const DEMO_TEAM_COUNT = 10;
export const DEMO_ROUNDS = 4;
/** One fixed literal, never `Date.now()` or a random seed — this IS the "seeded and reproducible"
 *  claim the page's own label makes. */
export const DEMO_SEED = 20260905;

const DEMO_SEED_NAMESPACE = "assistant-demo";
const DEMO_COMPUTED_BASIS = "A replayed room, seeded and reproducible. Not a live board.";

const TEAM_IDS: readonly string[] = Array.from({ length: DEMO_TEAM_COUNT }, (_, i) => `team_${i + 1}`);
/** Seat 4 of 10 — neither the first nor the last to pick, so the demo shows an ordinary snake
 *  turn rather than the two edge cases (picks back to back, or the longest possible wait). */
export const DEMO_POV_TEAM_ID = TEAM_IDS[3]!;

function teamLabel(teamId: string): string {
  return teamId === DEMO_POV_TEAM_ID ? "You" : `Team ${TEAM_IDS.indexOf(teamId) + 1}`;
}

/** Generous, proportionally-interleaved supply (the same idiom `run.test.ts`'s own `BOARD`
 *  fixture uses) — four rounds across ten teams draft at most 40 players, so this pool never
 *  comes close to running out at any position. */
const POSITION_PLAN: readonly (readonly [Position, number])[] = [
  ["QB", 24],
  ["RB", 50],
  ["WR", 60],
  ["TE", 24],
  ["K", 12],
  ["DEF", 12],
];

/** A synthetic "NFL team" code purely to give `byeCollisionFor` something to collide on — never
 *  a real franchise's schedule. */
const DEMO_NFL_TEAM_CODES: readonly string[] = Array.from({ length: 16 }, (_, i) => `DEMO${i + 1}`);
const DEMO_BYE_WEEKS: readonly (readonly [string, number])[] = DEMO_NFL_TEAM_CODES.map((code, i) => [code, 6 + (i % 9)] as const);

/** A believable, purely synthetic points curve: each position peaks at a different level and
 *  decays exponentially with rank, which is what actually produces the occasional real tier
 *  cliff `tiersOf` finds (a smooth exponential's early gaps are several times its late ones,
 *  never a hand-placed break). The exact numbers are invented; the CLIFFS `tiersOf` finds in
 *  them, and every make-it-back percentage downstream, are not. */
const PEAK_POINTS: Readonly<Record<Position, number>> = { QB: 380, RB: 340, WR: 320, TE: 250, K: 150, DEF: 155 };
const DECAY_SCALE: Readonly<Record<Position, number>> = { QB: 10, RB: 16, WR: 18, TE: 8, K: 6, DEF: 6 };

export interface DemoPlayer {
  readonly playerId: string;
  /** `"RB 4"` — position and within-position rank, never a name resembling a real athlete's. */
  readonly displayName: string;
  readonly position: Position;
  readonly nflTeam: string;
}

interface DemoPoolEntry extends DemoPlayer {
  readonly projectedPoints: number;
}

/** The room's own board, best player first — the exact interleave idiom `run.test.ts`'s `BOARD`
 *  fixture already uses, so the bot brain sees the same kind of proportionally-mixed pool a real
 *  evidence board hands it, rather than every quarterback before any running back. */
function buildPool(): readonly DemoPoolEntry[] {
  // A running counter across every position bucket, not a per-bucket one — cycling the same
  // handful of team codes across the WHOLE pool is what gives `byeCollisionFor` more than one
  // rostered player sharing a bye to ever collide on.
  let nflTeamCursor = 0;
  const buckets = POSITION_PLAN.map(([position, count]) =>
    Array.from({ length: count }, (_, i): DemoPoolEntry => {
      const rank = i + 1;
      const points = PEAK_POINTS[position] * Math.exp(-i / DECAY_SCALE[position]);
      const nflTeam = DEMO_NFL_TEAM_CODES[nflTeamCursor % DEMO_NFL_TEAM_CODES.length]!;
      nflTeamCursor += 1;
      return {
        playerId: `${position.toLowerCase()}${rank}`,
        displayName: `${position} ${rank}`,
        position,
        nflTeam,
        projectedPoints: Math.round(points * 10) / 10,
      };
    }),
  );
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
}

/** A consistent, if synthetic, market rank: overall order by projected points, 1-based — "any
 *  consistent market will do" (`call.ts`'s own docblock for this exact fallback). */
function evidenceRanks(pool: readonly DemoPoolEntry[]): ReadonlyMap<string, number> {
  const sorted = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  return new Map(sorted.map((entry, index) => [entry.playerId, index + 1] as const));
}

/** One `tier_cliff` row per player whose own position, at his own rank, sits at a real gap —
 *  computed exactly once from the static valuation (never recomputed as the draft empties the
 *  pool): `tierCountdowns`' own docblock says a room's tier reasons are read off the board as
 *  taken, not live-recounted against who is still undrafted, and a demo built on the identical
 *  `assistantCallCore` owes its ambient reads the identical contract. */
export interface DemoTierReason {
  readonly playerId: string;
  readonly playersLeftInTier: number;
  readonly dropToNextTier: number;
}

function computeTierReasons(valuedById: ReadonlyMap<string, ValuedEntry>): readonly DemoTierReason[] {
  const byPosition = new Map<Position, ValuedEntry[]>();
  for (const entry of valuedById.values()) {
    const bucket = byPosition.get(entry.position) ?? [];
    bucket.push(entry);
    byPosition.set(entry.position, bucket);
  }

  const rows: DemoTierReason[] = [];
  for (const bucket of byPosition.values()) {
    bucket.sort((a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId));
    const values = bucket.map((entry) => entry.valueOverReplacement);
    bucket.forEach((entry, index) => {
      const standing = tierStanding(values, index);
      if (standing.dropToNextTier > 0) {
        rows.push({ playerId: entry.playerId, playersLeftInTier: standing.playersLeftInTier, dropToNextTier: standing.dropToNextTier });
      }
    });
  }
  return rows;
}

export interface DemoPick {
  readonly pickNumber: number;
  readonly round: number;
  readonly teamId: string;
  readonly teamLabel: string;
  readonly playerId: string;
}

export interface AssistantDemoFixture {
  readonly povTeamId: string;
  readonly povLabel: string;
  /** 1-based draft-order slot — `"You hold seat 4"`, never a literal duplicated at the render
   *  site. */
  readonly povSeatNumber: number;
  readonly teamCount: number;
  readonly rounds: number;
  readonly seed: number;
  /** The full board, best player first — includes every player who is ever drafted across the
   *  replayed rounds AND every player left over, so a step near the end can still resolve a
   *  `positionsById`/`displayName` lookup for a name mentioned in an earlier step's beat. */
  readonly players: readonly DemoPlayer[];
  readonly byeWeeksByTeam: readonly (readonly [string, number])[];
  /** In pick-number order, length `teamCount * rounds`. */
  readonly picks: readonly DemoPick[];
  readonly tierReasons: readonly DemoTierReason[];
  /**
   * The POV seat's own real `AssistantCallView`, one per step — `calls[k]` is the call as it
   * stood after exactly `k` picks have landed (so `calls[0]` is the pre-draft call, `calls
   * [picks.length]` the call after the last replayed pick). Length `picks.length + 1`.
   */
  readonly calls: readonly AssistantCallView[];
}

function buildDraftConfig(): DraftConfig {
  return {
    draftId: `assistant_demo_${DEMO_SEED}`,
    leagueId: "assistant_demo",
    format: "snake",
    kickoffAt: SIM_INSTANT,
    auctionBudget: null,
    slotConfig: STANDARD_ROSTER_SLOTS,
    clockSchedule: [],
  };
}

/** The asking seat's own picks, as `classifyBuild` needs to see them — the identical shape
 *  `call.ts`'s own private `classifiablePicks` builds for a real room, reproduced here rather
 *  than exported from that module purely for this: this is the one piece of `assistantCallCore`'s
 *  surrounding plumbing a caller must still supply for itself, since it depends on how the
 *  caller's own `DraftState.pool` is shaped. */
function classifiablePicksFor(state: DraftState, askingTeamId: string): readonly ClassifiablePick[] {
  const positionByPlayerId = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  return state.picks.filter((pick) => pick.teamId === askingTeamId).map((pick) => ({ round: pick.round, position: positionByPlayerId.get(pick.playerId)! }));
}

function buildFixture(): AssistantDemoFixture {
  const pool = buildPool();
  const draftPool: readonly DraftPoolEntry[] = pool.map((entry) => ({ playerId: entry.playerId, position: entry.position }));

  const shape: LeagueShape = { teamCount: DEMO_TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS };
  const { byPlayerId } = valueBoardIndexed(
    pool.map((entry) => ({ playerId: entry.playerId, position: entry.position, projectedPoints: entry.projectedPoints })),
    shape,
  );
  const adpByPlayerId = evidenceRanks(pool);
  const valuedById: ReadonlyMap<string, ValuedEntry> = new Map(
    [...byPlayerId].map(([playerId, entry]) => [playerId, { ...entry, averageDraftPosition: adpByPlayerId.get(playerId)! }] as const),
  );

  const runResult = runOneDraft({ teamIds: TEAM_IDS, board: draftPool, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: DEMO_ROUNDS, seed: DEMO_SEED });

  const config = buildDraftConfig();
  const start: StartDraftAction = { v: DRAFT_ACTION_VERSION, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: TEAM_IDS, pool: draftPool, minBid: 1 };

  const states: DraftState[] = [submit(initialDraftState(config), start)];
  for (const pick of runResult.picks) {
    const action: MakePickAction = { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId: pick.teamId, playerId: pick.playerId };
    states.push(submit(states[states.length - 1]!, action));
  }

  const calls: AssistantCallView[] = states.map((state) => {
    const winningBuilds = null; // honest: no cached sim run exists for a demo room (module docblock).
    const call = assistantCallCore({
      state,
      askingTeamId: DEMO_POV_TEAM_ID,
      valued: valuedById,
      shape,
      seedNamespace: DEMO_SEED_NAMESPACE,
      winningBuilds,
      computedBasis: DEMO_COMPUTED_BASIS,
    });
    if (call !== null) return call;
    // Defensive only (see `askingWindow`'s own docblock: an in-progress snake draft always owes
    // every seat at least one more pick) — never reached with `DEMO_ROUNDS < totalRosterSlots`.
    return {
      pickNumber: state.pickNumber,
      onTheClock: false,
      candidates: [],
      yourBuild: classifyBuild(classifiablePicksFor(state, DEMO_POV_TEAM_ID)),
      winningBuilds,
      computedBasis: DEMO_COMPUTED_BASIS,
    };
  });

  const picks: readonly DemoPick[] = runResult.picks.map((pick) => ({
    pickNumber: pick.pickNumber,
    round: pick.round,
    teamId: pick.teamId,
    teamLabel: teamLabel(pick.teamId),
    playerId: pick.playerId,
  }));

  return {
    povTeamId: DEMO_POV_TEAM_ID,
    povLabel: "You",
    povSeatNumber: TEAM_IDS.indexOf(DEMO_POV_TEAM_ID) + 1,
    teamCount: DEMO_TEAM_COUNT,
    rounds: DEMO_ROUNDS,
    seed: DEMO_SEED,
    players: pool.map(({ playerId, displayName, position, nflTeam }) => ({ playerId, displayName, position, nflTeam })),
    byeWeeksByTeam: DEMO_BYE_WEEKS,
    picks,
    tierReasons: computeTierReasons(valuedById),
    calls,
  };
}

/** Built once, at module scope — see the module docblock. */
export const ASSISTANT_DEMO_FIXTURE: AssistantDemoFixture = buildFixture();
