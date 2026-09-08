/**
 * The bot brain's one sampler. Pure over `DraftState` and an `Rng` — no I/O, no clock, no
 * `Math.random()` — so a draft's stored seed replays its bots exactly (the DI law from `./rng`).
 * Every tunable comes from `MOCK_CONFIG.strategy`/`MOCK_CONFIG.botDelay`; every legality answer
 * comes from the engine's own selectors (`availablePool` + `assignSlot`, the identical oracle
 * `bestAvailableFor` uses), never a second rule that could drift from what `reduceDraft` accepts.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import { MS_PER_SECOND } from "@/domain/duration";
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { assignSlot, availablePool, draftedPlayerIds, needMultiplier, queuedEntriesFor, rankWeight, rosterFor, type DraftState } from "@/draft-engine";
import type { BotArchetype } from "./archetypes";
import { MOCK_CONFIG } from "./config";
import type { Rng } from "./rng";

/**
 * The need term, parameterized by this bot's own brain: each open dedicated starting slot
 * warms the position by `needPerOpenStartingSlot` scaled by the archetype's `needWeight`; a
 * position with no open starter left cools to `startersFilledDamp` — under 1, so surplus at a
 * position reads as disinterest, not neutrality. The rank-and-need SHAPE itself
 * (`rankWeight`/`needMultiplier`) is the engine's own (`@/draft-engine`'s `scoring.ts`, shared
 * with the money rooms' autopick); only the dials here are `MOCK_CONFIG.strategy`'s.
 */
function botNeedMultiplier(position: Position, roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[], archetype: BotArchetype): number {
  return needMultiplier(position, roster, slotConfig, {
    openSlotBoost: archetype.needWeight * MOCK_CONFIG.strategy.needPerOpenStartingSlot,
    filledDamp: MOCK_CONFIG.strategy.startersFilledDamp,
  });
}

/**
 * THE POOL'S POSITION INDEX, one per pool array (the immutability rule's sanctioned memo shape:
 * a `WeakMap` keyed by an object that never changes). A draft's `pool` is snapshotted at
 * START_DRAFT and every reducer carries the same array forward, so the advisor's 200
 * continuations of one room — some 4,600 simulated picks — all read one index instead of each
 * walking 1,700 entries to place four recent picks (the 2026-09-08 pace round's CPU profile put
 * that walk at 13% of every simulate; the pool round-trips below were another 70%).
 */
const positionIndexByPool = new WeakMap<readonly DraftPoolEntry[], ReadonlyMap<string, Position>>();

function positionIndexFor(pool: readonly DraftPoolEntry[]): ReadonlyMap<string, Position> {
  const held = positionIndexByPool.get(pool);
  if (held !== undefined) return held;
  const index: ReadonlyMap<string, Position> = new Map(pool.map((entry) => [entry.playerId, entry.position] as const));
  positionIndexByPool.set(pool, index);
  return index;
}

/**
 * How many of the last `runReaction.window` picks landed at each position — read off
 * `state.picks` against the pool's own position record, computed once per pick and handed to
 * `runMultiplier` for every candidate.
 */
function recentPositionCounts(state: DraftState): ReadonlyMap<Position, number> {
  const positionOf = positionIndexFor(state.pool);
  const counts = new Map<Position, number>();
  for (const pick of state.picks.slice(-MOCK_CONFIG.strategy.runReaction.window)) {
    const position = positionOf.get(pick.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}

/**
 * The run term — the founder's real-world scenario. At `threshold` same-position picks inside
 * the window, that position warms for EVERY brain (`baseBoost`, mild: a real room feels a run)
 * and spikes for the `followsRuns` archetype (`needBoost`: the one bot that panics with the room).
 */
function runMultiplier(position: Position, recentCounts: ReadonlyMap<Position, number>, archetype: BotArchetype): number {
  const { threshold, needBoost, baseBoost } = MOCK_CONFIG.strategy.runReaction;
  if ((recentCounts.get(position) ?? 0) < threshold) return 1;
  return archetype.followsRuns === true ? needBoost : baseBoost;
}

/**
 * The first `reachDepth` entries of the board this roster can legally take, in ranking order —
 * the structural reach cap: nothing outside this list can ever be sampled, so a bot's worst
 * "reach" is bounded by construction, not by luck.
 */
function topEligible(board: readonly DraftPoolEntry[], canRoster: (entry: DraftPoolEntry) => boolean): readonly DraftPoolEntry[] {
  const candidates: DraftPoolEntry[] = [];
  for (const entry of board) {
    if (canRoster(entry)) {
      candidates.push(entry);
      if (candidates.length === MOCK_CONFIG.strategy.reachDepth) break;
    }
  }
  return candidates;
}

/** One weighted draw: `rng.next()` scaled to the total, walked down the weights. */
function weightedIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let draw = rng.next() * total;
  for (let i = 0; i < weights.length - 1; i++) {
    draw -= weights[i]!;
    if (draw < 0) return i;
  }
  return weights.length - 1;
}

/** One sampler candidate and the weight the brain gives him at this exact turn. */
export interface BotCandidateWeight {
  readonly playerId: string;
  readonly weight: number;
}

/**
 * THE SAMPLER'S OWN WEIGHTS, exposed (draft advisor round, spec 3.1a). Every legal candidate
 * inside the reach window, in board order, each scored `rankWeight × posBias × needMultiplier ×
 * runMultiplier` for `archetype` — the exact distribution `chooseBotPick` draws from, so the
 * advisor's opponent model can ask "how likely was this seat's observed pick under each brain"
 * against the ONE sampler rather than a second scoring rule that could drift from it. Empty when
 * the roster can take nothing that remains.
 */
export function botCandidateWeights(state: DraftState, teamId: string, archetype: BotArchetype): readonly BotCandidateWeight[] {
  const roster = rosterFor(state, teamId);
  const slotConfig = state.config.slotConfig;
  const canRoster = (entry: DraftPoolEntry): boolean => assignSlot({ position: entry.position, roster, slotConfig }).ok;
  const candidates = topEligible(availablePool(state), canRoster);
  const recentCounts = recentPositionCounts(state);
  return candidates.map((entry, index) => ({
    playerId: entry.playerId,
    weight:
      rankWeight(index, MOCK_CONFIG.strategy.temperature) *
      (archetype.posBias[entry.position] ?? 1) *
      botNeedMultiplier(entry.position, roster, slotConfig, archetype) *
      runMultiplier(entry.position, recentCounts, archetype),
  }));
}

/**
 * The first queued player this roster can still legally take, or null — the same preference
 * `bestAvailableFor` states first. Answered without touching the pool when the team holds no
 * queue at all (every bot, and every simulated seat): `queuedEntriesFor` already projects the
 * queue onto the pool, so "still available" is "not yet drafted", a set the size of the pick
 * log rather than of the board.
 */
function legalQueuedPick(state: DraftState, teamId: string): string | null {
  if ((state.queues[teamId] ?? []).length === 0) return null;
  const roster = rosterFor(state, teamId);
  const drafted = draftedPlayerIds(state);
  const queued = queuedEntriesFor(state, teamId).find(
    (entry) => !drafted.has(entry.playerId) && assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok,
  );
  return queued?.playerId ?? null;
}

/**
 * The bot brain: one temperature-sampled pick for `teamId`, drawn from the caller's own seeded
 * stream (`rngFor(seed, teamId)` — the stream key T1 made load-bearing). Preference order
 * mirrors `bestAvailableFor` exactly: a legal queued player first (bots hold no queues today,
 * but the autopick policy is stated once, not twice), then a rank-weighted sample over the top
 * `reachDepth` eligible entries under `botCandidateWeights`. Null only when the roster can take
 * nothing that remains — the same answer `bestAvailableFor` would give.
 */
export function chooseBotPick(state: DraftState, teamId: string, archetype: BotArchetype, rng: Rng): string | null {
  const queued = legalQueuedPick(state, teamId);
  if (queued !== null) return queued;

  const candidates = botCandidateWeights(state, teamId, archetype);
  if (candidates.length === 0) return null;
  return candidates[weightedIndex(candidates.map((candidate) => candidate.weight), rng)]!.playerId;
}

/** The delay draw's upper bound for one room's clock: base plus jitter, capped under the clock's
 *  own safety fraction (`config.test.ts` pins the cap slack for every offered clock). */
function maxThinkDelayMs(pickClockSeconds: number): number {
  const { baseMs, jitterMs, maxFractionOfClock } = MOCK_CONFIG.botDelay;
  return Math.min(baseMs + jitterMs, pickClockSeconds * MS_PER_SECOND * maxFractionOfClock);
}

/**
 * A bot's think delay for one pick, in milliseconds, drawn from that pick's own seeded stream:
 * uniform over `[baseMs - jitterMs, min(baseMs + jitterMs, clock × maxFractionOfClock)]`. The
 * bounds are `MOCK_CONFIG.botDelay`'s, and `config.test.ts` pins the jitter under the base and
 * the top under the fastest clock's fraction, so the interval is never empty for any offered
 * clock — no branch here has to defend it. Fractional on purpose: the drivers stamp the pick at
 * the first whole millisecond at or after this instant, so two drivers stamp identically.
 */
export function botThinkDelayMs(pickClockSeconds: number, rng: Rng): number {
  const { baseMs, jitterMs } = MOCK_CONFIG.botDelay;
  const minMs = baseMs - jitterMs;
  return minMs + rng.next() * (maxThinkDelayMs(pickClockSeconds) - minMs);
}

/**
 * The expected value of `botThinkDelayMs`' uniform draw — the midpoint of the same interval,
 * from the same bounds, never a second literal (Task 10's persona checkpoint, finding 1) — in
 * SECONDS, the unit the wire carries. The snapshot route hands this to the room
 * (`MockRoomInfo.expectedBotPickSeconds`) so the dock's wait estimate can price a practice
 * opponent's turn at what it actually costs instead of the full pick clock — the flat
 * clock-per-pick estimate overstated a mock's wait roughly tenfold, and a first-timer who
 * walks away on a wrong "~8m" misses her first pick.
 */
export function expectedBotThinkDelaySeconds(pickClockSeconds: number): number {
  const { baseMs, jitterMs } = MOCK_CONFIG.botDelay;
  return (baseMs - jitterMs + maxThinkDelayMs(pickClockSeconds)) / 2 / MS_PER_SECOND;
}
