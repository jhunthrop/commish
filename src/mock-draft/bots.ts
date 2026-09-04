/**
 * The bot brain's one sampler. Pure over `DraftState` and an `Rng` — no I/O, no clock, no
 * `Math.random()` — so a draft's stored seed replays its bots exactly (the DI law from `./rng`).
 * Every tunable comes from `MOCK_CONFIG.strategy`/`MOCK_CONFIG.botDelay`; every legality answer
 * comes from the engine's own selectors (`availablePool` + `assignSlot`, the identical oracle
 * `bestAvailableFor` uses), never a second rule that could drift from what `reduceDraft` accepts.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";
import { assignSlot, availablePool, needMultiplier, queuedEntriesFor, rankWeight, rosterFor, type DraftState } from "@/draft-engine";
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
 * How many of the last `runReaction.window` picks landed at each position — read off
 * `state.picks` against the pool's own position record, computed once per pick and handed to
 * `runMultiplier` for every candidate.
 */
function recentPositionCounts(state: DraftState): ReadonlyMap<Position, number> {
  const recentIds = new Set(state.picks.slice(-MOCK_CONFIG.strategy.runReaction.window).map((pick) => pick.playerId));
  const counts = new Map<Position, number>();
  for (const entry of state.pool) {
    if (recentIds.has(entry.playerId)) counts.set(entry.position, (counts.get(entry.position) ?? 0) + 1);
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

/**
 * The bot brain: one temperature-sampled pick for `teamId`, drawn from the caller's own seeded
 * stream (`rngFor(seed, teamId)` — the stream key T1 made load-bearing). Preference order
 * mirrors `bestAvailableFor` exactly: a legal queued player first (bots hold no queues today,
 * but the autopick policy is stated once, not twice), then a rank-weighted sample over the top
 * `reachDepth` eligible entries, each scored
 * `rankWeight × posBias × needMultiplier × runMultiplier`. Null only when the roster can take
 * nothing that remains — the same answer `bestAvailableFor` would give.
 */
export function chooseBotPick(state: DraftState, teamId: string, archetype: BotArchetype, rng: Rng): string | null {
  const roster = rosterFor(state, teamId);
  const slotConfig = state.config.slotConfig;
  const board = availablePool(state);
  const canRoster = (entry: DraftPoolEntry): boolean => assignSlot({ position: entry.position, roster, slotConfig }).ok;

  const availableIds = new Set(board.map((entry) => entry.playerId));
  const queued = queuedEntriesFor(state, teamId).find((entry) => availableIds.has(entry.playerId) && canRoster(entry));
  if (queued !== undefined) return queued.playerId;

  const candidates = topEligible(board, canRoster);
  if (candidates.length === 0) return null;

  const recentCounts = recentPositionCounts(state);
  const weights = candidates.map(
    (entry, index) =>
      rankWeight(index, MOCK_CONFIG.strategy.temperature) *
      (archetype.posBias[entry.position] ?? 1) *
      botNeedMultiplier(entry.position, roster, slotConfig, archetype) *
      runMultiplier(entry.position, recentCounts, archetype),
  );
  return candidates[weightedIndex(weights, rng)]!.playerId;
}

/**
 * A bot's think delay for one pick, in seconds, drawn from that pick's own seeded stream:
 * uniform over `[minSeconds, min(maxSeconds, clock × maxFractionOfClock)]`. The bounds are
 * `MOCK_CONFIG.botDelay`'s, and `config.test.ts` pins `maxSeconds` under the fastest clock's
 * fraction (and `minSeconds` under `maxSeconds`), so the interval is never empty for any
 * offered clock — no branch here has to defend it.
 */
export function botThinkDelaySeconds(pickClockSeconds: number, rng: Rng): number {
  const { minSeconds, maxSeconds, maxFractionOfClock } = MOCK_CONFIG.botDelay;
  const cap = Math.min(maxSeconds, pickClockSeconds * maxFractionOfClock);
  return minSeconds + rng.next() * (cap - minSeconds);
}

/**
 * The expected value of `botThinkDelaySeconds`' uniform draw — the midpoint of the same
 * interval, from the same bounds, never a second literal (Task 10's persona checkpoint,
 * finding 1). The snapshot route carries this to the room
 * (`MockRoomInfo.expectedBotPickSeconds`) so the dock's wait estimate can price a practice
 * opponent's turn at what it actually costs instead of the full pick clock — the flat
 * clock-per-pick estimate overstated a mock's wait roughly tenfold, and a first-timer who
 * walks away on a wrong "~8m" misses her first pick.
 */
export function expectedBotThinkDelaySeconds(pickClockSeconds: number): number {
  const { minSeconds, maxSeconds, maxFractionOfClock } = MOCK_CONFIG.botDelay;
  return (minSeconds + Math.min(maxSeconds, pickClockSeconds * maxFractionOfClock)) / 2;
}
