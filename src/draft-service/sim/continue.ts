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
 * draft, the instant the asking seat is back on the clock for the LAST time the caller asked for.
 *
 * CONTROLLER RESOLUTION (the asking seat's own current pick, ruling R-3): when the asking seat is
 * ALREADY on the clock at the moment this is called, its own current pick is played FIRST — from
 * the board minus `excludeFromAskingSeat`, under a fixed neutral archetype (`best_available`:
 * `chooseBotPick` under it reduces to the engine's own rank-and-need answer, never a persona
 * choice for the seat whose own odds are being measured) — before continuation resumes toward the
 * seat's NEXT turn. When the asking seat is NOT on the clock, no exclusion applies to anyone:
 * every other seat picks exactly as a real bot would, shortlist included, because other seats
 * taking the asking seat's targets is the entire thing being measured.
 *
 * THE HORIZON (draft advisor round, spec 3.1a). `horizon` is how many of the asking seat's
 * UPCOMING turns to play through: one run snapshots the board at each of them
 * (`undraftedAtTurn[k]` is the k-th upcoming turn, `undrafted` stays the first for every existing
 * caller), and between them the asking seat's own intermediate picks play under the same neutral
 * brain and the same exclusion its current pick does, so a target's odds at a later turn are
 * never spoiled by the asking seat itself taking him earlier. `played` is every pick the run made,
 * which is what the "ahead of you" read tallies.
 *
 * THE DRIVERS (same amendment). `drivers` is the advisor's opponent model (`seat-model.ts`): a
 * seat with an inferred or prior archetype samples under it, a seat on autopick picks exactly as
 * the clock would (`bestAvailableFor`). Absent, every seat draws the seeded archetype deal
 * `run.ts` uses, which keeps every pre-amendment caller byte-identical.
 */
import type { MakePickAction } from "@/domain/draft";
import { availablePool, bestAvailableFor, isComplete, teamOnClock, type DraftState } from "@/draft-engine";
import { assignArchetypes, type BotArchetype } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { SIM_INSTANT, submit } from "./run";
import { NEUTRAL_ARCHETYPE, type SeatDriver, type SeatDrivers } from "./seat-model";

/** No player excluded — the shared instance every non-asking-seat pick submits under. */
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

export interface ContinueDraftInput {
  /** A live snake DraftState mid-draft — the room's replayed state, never re-fetched here. */
  readonly state: DraftState;
  /** The seat asking. Continuation stops the moment this seat is back on the clock for the
   *  `horizon`-th time (or the draft completes). */
  readonly askingTeamId: string;
  /** Players the asking seat must NOT take in this run (ruling R-3). */
  readonly excludeFromAskingSeat: ReadonlySet<string>;
  readonly seed: number;
  /** How many of the asking seat's upcoming turns to play through. Default 1. */
  readonly horizon?: number;
  /** The opponent model. Absent means the seeded archetype deal (see the module docblock). */
  readonly drivers?: SeatDrivers;
}

export interface PlayedPick {
  readonly pickNumber: number;
  readonly teamId: string;
  readonly playerId: string;
}

export interface ContinueDraftResult {
  /** Player ids still undrafted when the asking seat first came back on the clock. */
  readonly undrafted: ReadonlySet<string>;
  /** One snapshot per upcoming turn reached, first turn first. Shorter than `horizon` only when
   *  the draft ended before the later turns existed. */
  readonly undraftedAtTurn: readonly ReadonlySet<string>[];
  /** True when the draft completed before the asking seat's `horizon`-th upcoming turn. */
  readonly draftEnded: boolean;
  /** Every pick this run made, in pick order. */
  readonly played: readonly PlayedPick[];
}

/** One seat's pick for `state.pickNumber`: the autopick policy for a seat the clock drives,
 *  otherwise a seeded draw from the seat's archetype (`${teamId}:cont:${pickNumber}`, distinct
 *  from a headless run's `:pick:` stream). `excluded` is honored by handing the sampler a shadow
 *  state whose `pool` has those ids removed — every OTHER field is the real state. */
function pickFor(state: DraftState, teamId: string, driver: SeatDriver, seed: number, excluded: ReadonlySet<string>): string | null {
  const candidateState = excluded.size === 0 ? state : { ...state, pool: state.pool.filter((entry) => !excluded.has(entry.playerId)) };
  if (driver.kind === "autopick") return bestAvailableFor(candidateState, teamId)?.playerId ?? null;
  const rng = rngFor(seed, `${teamId}:cont:${state.pickNumber}`);
  return chooseBotPick(candidateState, teamId, driver.archetype, rng);
}

/** `pickFor` plus the real `MAKE_PICK` submission — null when the seat can legally take nothing
 *  left in the (possibly excluded) pool, the one condition the loop below treats as a stop. */
function playPick(state: DraftState, teamId: string, driver: SeatDriver, seed: number, excluded: ReadonlySet<string>): { readonly state: DraftState; readonly pick: PlayedPick } | null {
  const playerId = pickFor(state, teamId, driver, seed, excluded);
  if (playerId === null) return null;
  const pick: PlayedPick = { pickNumber: state.pickNumber, teamId, playerId };
  const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
  return { state: submit(state, action), pick };
}

function driverFor(drivers: SeatDrivers | undefined, dealt: Readonly<Record<string, BotArchetype>>, teamId: string): SeatDriver {
  const given = drivers?.[teamId];
  if (given !== undefined) return given;
  const archetype = dealt[teamId] ?? NEUTRAL_ARCHETYPE;
  return { kind: "archetype", archetype, basis: "prior", picksObserved: 0 };
}

const NEUTRAL_DRIVER: SeatDriver = { kind: "archetype", archetype: NEUTRAL_ARCHETYPE, basis: "prior", picksObserved: 0 };

function snapshot(state: DraftState): ReadonlySet<string> {
  return new Set(availablePool(state).map((entry) => entry.playerId));
}

/**
 * Drives `input.state` forward, one real `MAKE_PICK` at a time, until `askingTeamId` has been
 * back on the clock `horizon` times or the draft completes. Never mutates the caller's state —
 * `reduceDraft` already returns new state at every step, and this function only ever reassigns
 * its own local binding.
 */
export function continueDraft(input: ContinueDraftInput): ContinueDraftResult {
  const { askingTeamId, excludeFromAskingSeat, seed, drivers } = input;
  const horizon = input.horizon ?? 1;
  const dealt = assignArchetypes(seed, input.state.draftOrder);
  const askingSeatStartsOnClock = !isComplete(input.state) && teamOnClock(input.state) === askingTeamId;

  let state = input.state;
  let askingSeatPlayedCurrentPick = !askingSeatStartsOnClock;
  const snapshots: ReadonlySet<string>[] = [];
  const played: PlayedPick[] = [];

  while (!isComplete(state) && snapshots.length < horizon) {
    const teamId = teamOnClock(state);
    if (teamId === null) break; // defensive: cannot occur in a snake continuation with no owed picks

    const isAsking = teamId === askingTeamId;
    if (isAsking && askingSeatPlayedCurrentPick) {
      snapshots.push(snapshot(state));
      if (snapshots.length === horizon) break;
    }
    if (isAsking) askingSeatPlayedCurrentPick = true;

    const next = isAsking
      ? playPick(state, teamId, NEUTRAL_DRIVER, seed, excludeFromAskingSeat)
      : playPick(state, teamId, driverFor(drivers, dealt, teamId), seed, NO_EXCLUSIONS);
    if (next === null) break;
    state = next.state;
    played.push(next.pick);
  }

  const first = snapshots[0] ?? snapshot(state);
  return { undrafted: first, undraftedAtTurn: snapshots, draftEnded: isComplete(state), played };
}
