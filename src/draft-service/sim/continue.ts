/**
 * THE SIM CONTINUATION SEAM — Draft HQ's "make-it-back odds" primitive. A live room's Assistant
 * wants to know, for a player still on the board, whether the asking seat is likely to get
 * another crack at them: continue the room's OWN mid-draft `DraftState` with the existing bot
 * brain until the asking seat is back on the clock, then look at what is still undrafted. Task 2
 * builds the odds loop (many seeded continuations, aggregated) on top of this one primitive.
 *
 * This module carries none of `run.ts`'s own legality logic twice — it drives the identical real
 * engine (`admitCommand`/`reduceDraft`, via the SAME exported `submit` helper `run.ts` uses for a
 * headless run), the same `SIM_INSTANT` literal, the same seeded bot brain
 * (`chooseBotPick`/`assignArchetypes`/`rngFor`). The one behavior a headless run never needed:
 * this continuation starts from a REAL room's state (never re-fetched here — the caller replays
 * the room's own action log and hands the result in), and it must stop, not run to the end of the
 * draft, the instant the asking seat is back on the clock.
 *
 * CONTROLLER RESOLUTION (the asking seat's own current pick, ruling R-3): when the asking seat is
 * ALREADY on the clock at the moment this is called, its own current pick is played FIRST — from
 * the board minus `excludeFromAskingSeat`, under a fixed neutral archetype (`best_available`:
 * `chooseBotPick` under it reduces to the engine's own rank-and-need answer, never a persona
 * choice for the seat whose own odds are being measured) — before continuation resumes toward the
 * seat's NEXT turn. When the asking seat is NOT on the clock, no exclusion applies to anyone:
 * every other seat picks exactly as a real bot would, shortlist included, because other seats
 * taking the asking seat's targets is the entire thing being measured.
 */
import type { MakePickAction } from "@/domain/draft";
import { availablePool, isComplete, teamOnClock, type DraftState } from "@/draft-engine";
import { assignArchetypes, BOT_ARCHETYPES, type BotArchetype } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { SIM_INSTANT, submit } from "./run";

/** `best_available`'s weights are already neutral (needWeight 1.0, no `posBias`) — looked up by
 *  name rather than pinned to an array index, so a future reorder of `BOT_ARCHETYPES` can never
 *  silently swap in a different persona for the asking seat's own pick. */
const NEUTRAL_ARCHETYPE: BotArchetype = (() => {
  const neutral = BOT_ARCHETYPES.find((archetype) => archetype.name === "best_available");
  if (neutral === undefined) throw new Error("continueDraft: BOT_ARCHETYPES no longer has a best_available entry");
  return neutral;
})();

/** No player excluded — the shared instance every non-asking-seat pick (and every asking-seat
 *  pick played after its own current turn) submits under. */
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

export interface ContinueDraftInput {
  /** A live snake DraftState mid-draft — the room's replayed state, never re-fetched here. */
  readonly state: DraftState;
  /** The seat asking. Continuation stops the moment this seat is back on the clock (or the draft completes). */
  readonly askingTeamId: string;
  /** Players the asking seat must NOT take in this run (ruling R-3). */
  readonly excludeFromAskingSeat: ReadonlySet<string>;
  readonly seed: number;
}

export interface ContinueDraftResult {
  /** Player ids still undrafted when the asking seat came back on the clock. */
  readonly undrafted: ReadonlySet<string>;
  /** True when the draft completed before the asking seat's next turn (no next pick exists). */
  readonly draftEnded: boolean;
}

/** One seat's pick for `state.pickNumber`, drawn from this continuation's own seeded stream
 *  (`${teamId}:cont:${pickNumber}`, distinct from a headless run's `:pick:` stream so the two
 *  never draw the same sequence for the same seed). `excluded` is honored by handing
 *  `chooseBotPick` a shadow state whose `pool` has those ids removed — every OTHER field (picks,
 *  rosters, queues, config) is the real state, so legality is exactly what the real engine would
 *  compute minus the excluded ids as candidates. */
function pickFor(state: DraftState, teamId: string, archetype: BotArchetype, seed: number, excluded: ReadonlySet<string>): string | null {
  const rng = rngFor(seed, `${teamId}:cont:${state.pickNumber}`);
  const candidateState = excluded.size === 0 ? state : { ...state, pool: state.pool.filter((entry) => !excluded.has(entry.playerId)) };
  return chooseBotPick(candidateState, teamId, archetype, rng);
}

/** `pickFor` plus the real `MAKE_PICK` submission — null when the seat can legally take nothing
 *  left in the (possibly excluded) pool, the one condition the loop below treats as a stop. */
function playPick(state: DraftState, teamId: string, archetype: BotArchetype, seed: number, excluded: ReadonlySet<string>): DraftState | null {
  const playerId = pickFor(state, teamId, archetype, seed, excluded);
  if (playerId === null) return null;
  const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
  return submit(state, action);
}

/**
 * Drives `input.state` forward, one real `MAKE_PICK` at a time, until `askingTeamId` is on the
 * clock again or the draft completes. Never mutates the caller's state — `reduceDraft` already
 * returns new state at every step, and this function only ever reassigns its own local binding.
 */
export function continueDraft(input: ContinueDraftInput): ContinueDraftResult {
  const { askingTeamId, excludeFromAskingSeat, seed } = input;
  const askingSeatStartsOnClock = !isComplete(input.state) && teamOnClock(input.state) === askingTeamId;
  const archetypes = assignArchetypes(seed, input.state.draftOrder);

  let state = input.state;
  let askingSeatPlayedOwnPick = false;

  while (!isComplete(state)) {
    const teamId = teamOnClock(state);
    if (teamId === null) break; // defensive: cannot occur in a snake continuation with no owed picks

    if (teamId === askingTeamId) {
      if (!askingSeatStartsOnClock || askingSeatPlayedOwnPick) break; // back on the clock — stop here
      askingSeatPlayedOwnPick = true;
      const next = playPick(state, teamId, NEUTRAL_ARCHETYPE, seed, excludeFromAskingSeat);
      if (next === null) break;
      state = next;
      continue;
    }

    const next = playPick(state, teamId, archetypes[teamId]!, seed, NO_EXCLUSIONS);
    if (next === null) break;
    state = next;
  }

  return {
    undrafted: new Set(availablePool(state).map((entry) => entry.playerId)),
    draftEnded: isComplete(state),
  };
}
