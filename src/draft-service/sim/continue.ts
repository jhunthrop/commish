/**
 * THE ROOM CONTINUATION — one seeded run of a live room forward, every seat driven as a bot,
 * stopping after `throughPick` (or when the draft completes). The advisor's odds are built on
 * many of these from the SAME room state (`room-odds.ts`), and one run serves every seat in the
 * room at once (the founder's cost ruling, simplification round): survival before a seat's next
 * turn depends only on the picks made before that turn, so the run records every pick it
 * played and the table slices it per viewer.
 *
 * This module carries none of `run.ts`'s own legality logic twice — it drives the identical real
 * engine (`admitCommand`/`reduceDraft`, via the SAME exported `submit` helper `run.ts` uses for a
 * headless run), the same `SIM_INSTANT` literal, the same seeded bot brain
 * (`chooseBotPick`/`assignArchetypes`/`rngFor`). The one behavior a headless run never needed:
 * this continuation starts from a REAL room's state (never re-fetched here — the caller replays
 * the room's own action log and hands the result in).
 *
 * THE ON-CLOCK SEAT'S OWN PICK (ruling R-3, kept for the one seat it still applies to): the seat
 * on the clock right now is the one seat whose next pick is a human decision the viewer of that
 * seat is being advised on, and "will he still be there at my next turn" is a question about
 * PASSING on him. So that seat's current pick is played under the neutral archetype
 * (`best_available`, the engine's own rank-and-need answer, never a persona) from the board
 * minus `excludeFromOnClockSeat`, so the players the on-clock viewer is deciding between stay on
 * the board for every other seat to take. Every other pick in the run, that seat's later ones
 * included, plays under the seat's driver.
 *
 * THE DRIVERS (`seat-model.ts`): a seat with an inferred or prior archetype samples under it, a
 * seat on autopick picks exactly as the clock would (`bestAvailableFor`). Absent, every seat
 * draws the seeded archetype deal `run.ts` uses.
 */
import type { MakePickAction } from "@/domain/draft";
import { bestAvailableFor, isComplete, teamOnClock, type DraftState } from "@/draft-engine";
import { assignArchetypes, type BotArchetype } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import { SIM_INSTANT, submit } from "./run";
import { NEUTRAL_ARCHETYPE, type SeatDriver, type SeatDrivers } from "./seat-model";

/** No player excluded — the shared instance every ordinary pick submits under. */
const NO_EXCLUSIONS: ReadonlySet<string> = new Set();

const NEUTRAL_DRIVER: SeatDriver = { kind: "archetype", archetype: NEUTRAL_ARCHETYPE, basis: "prior", picksObserved: 0 };

export interface ContinueRoomInput {
  /** A live snake DraftState mid-draft — the room's replayed state, never re-fetched here. */
  readonly state: DraftState;
  readonly seed: number;
  /** The last pick number this run plays. The run stops once the room is past it. */
  readonly throughPick: number;
  /** Players the on-clock seat's CURRENT pick must not take (see the module docblock). */
  readonly excludeFromOnClockSeat: ReadonlySet<string>;
  /** The opponent model. Absent means the seeded archetype deal (see the module docblock). */
  readonly drivers?: SeatDrivers;
}

export interface PlayedPick {
  readonly pickNumber: number;
  readonly teamId: string;
  readonly playerId: string;
}

export interface ContinueRoomResult {
  /** Every pick this run made, in pick order. */
  readonly played: readonly PlayedPick[];
  /** True when the draft completed before `throughPick` was reached. */
  readonly draftEnded: boolean;
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
  // Stamped at the turn's own start, never the inert `SIM_INSTANT`: a live room's
  // `turnStartedAt` can sit in the future (the last batched bot's reveal instant, the batched
  // bots round), and `admitMakePick` refuses a pick stamped before it. The stamp is inert to
  // everything the table reads; it only has to be the turn's, so each simulated pick starts the
  // next turn at the same instant and the whole continuation admits.
  const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: state.turnStartedAt ?? SIM_INSTANT, teamId, playerId };
  return { state: submit(state, action), pick };
}

function driverFor(drivers: SeatDrivers | undefined, dealt: Readonly<Record<string, BotArchetype>>, teamId: string): SeatDriver {
  const given = drivers?.[teamId];
  if (given !== undefined) return given;
  const archetype = dealt[teamId] ?? NEUTRAL_ARCHETYPE;
  return { kind: "archetype", archetype, basis: "prior", picksObserved: 0 };
}

/**
 * Drives `input.state` forward, one real `MAKE_PICK` at a time, through `throughPick` or until
 * the draft completes. Never mutates the caller's state — `reduceDraft` already returns new
 * state at every step, and this function only ever reassigns its own local binding.
 */
export function continueRoom(input: ContinueRoomInput): ContinueRoomResult {
  const { seed, throughPick, excludeFromOnClockSeat, drivers } = input;
  const dealt = assignArchetypes(seed, input.state.draftOrder);
  const onClockPick = input.state.pickNumber;

  let state = input.state;
  const played: PlayedPick[] = [];
  while (!isComplete(state) && state.pickNumber <= throughPick) {
    const teamId = teamOnClock(state);
    if (teamId === null) break; // defensive: cannot occur in a snake continuation with no owed picks
    const isOnClockPick = state.pickNumber === onClockPick;
    // A seat cannot sit out its pick: when the exclusion covers everything it may legally take
    // (a pool the shortlist exhausts), the pick plays from the whole board instead of ending the
    // run with no odds for anyone.
    const next = isOnClockPick
      ? (playPick(state, teamId, NEUTRAL_DRIVER, seed, excludeFromOnClockSeat) ?? playPick(state, teamId, NEUTRAL_DRIVER, seed, NO_EXCLUSIONS))
      : playPick(state, teamId, driverFor(drivers, dealt, teamId), seed, NO_EXCLUSIONS);
    if (next === null) break;
    state = next.state;
    played.push(next.pick);
  }
  return { played, draftEnded: isComplete(state) };
}
