/**
 * ONE HEADLESS DRAFT — the real engine, driven straight through, with no clock, no SSE and no
 * persistence: the "leaner headless path" Task 1 asks for turns out to BE the real engine, run a
 * different way, rather than a second implementation of its legality:
 *
 *  - `admitCommand`/`reduceDraft` (`@/draft-engine`) are called EXACTLY as `draft-service` calls
 *    them for a real room's `MAKE_PICK` — nothing here re-implements slot assignment, budget
 *    checks or turn order.
 *  - The clock is never consulted. A real room waits for `TIMER_EXPIRE` because a human might act
 *    first; a sim has no human on any seat mid-run, so every turn is decided the instant it opens
 *    and submitted as an ordinary `MAKE_PICK`, in the SAME turn order `teamOnClock` already
 *    computes. This is what makes 1,000 full drafts a five-second job instead of a five-minute
 *    one (see `simulate.test.ts`'s own measured numbers) — the cost this engine actually carries
 *    is state transitions, not I/O, and a headless run pays for state transitions alone.
 *  - Every seat's pick, target slot included, is drawn from `chooseBotPick` (`@/mock-draft/bots`)
 *    against `board`, this run's own room-sharpness ordering (`board-order.ts`) — the identical
 *    sampler a practice mock draft's bots use, unmodified. The target seat is dealt an archetype
 *    from the SAME shuffled deck as every other seat (`assignArchetypes`): this sim does not
 *    invent a "neutral" persona for the slot being measured, because doing so would make "what
 *    wins from your slot" a claim about one hand-picked drafting style rather than about the
 *    genuine spread real people bring to a room.
 *
 * PICK LEGALITY EQUIVALENCE IS BY CONSTRUCTION, not by a parallel proof: every accepted pick in
 * this file passed through `reduceDraft`, so a sim roster can never hold an illegal assignment
 * the live engine would have rejected. `run.test.ts` still asserts this holds (no submitted
 * command is ever refused), as a regression guard against a future edit here breaking the
 * MAKE_PICK sequencing this reuse depends on.
 */
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import {
  admitCommand,
  initialDraftState,
  isComplete,
  reduceDraft,
  teamOnClock,
  totalRosterSlots,
  type CompletedPick,
  type DraftConfig,
  type DraftState,
} from "@/draft-engine";
import { assignArchetypes } from "@/mock-draft/archetypes";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";

/** A fixed instant every action in a sim carries. `MAKE_PICK` is admitted unconditionally
 *  (`admit.ts`'s own docblock) and no reducer this file exercises reads the clock, so the exact
 *  value is inert — one shared literal, never `Date.now()`, so a sim's own log is as
 *  reproducible as everything else about it. */
const SIM_INSTANT = "2026-01-01T00:00:00.000Z";

export interface RunOneDraftInput {
  readonly teamIds: readonly string[];
  /** This run's own room board, best player first — `board-order.ts`'s `simBoardOrder`. */
  readonly board: readonly DraftPoolEntry[];
  readonly rosterSlots: readonly RosterSlotConfig[];
  /** Rounds to play before stopping, capped at the roster's own full size. Fewer than the full
   *  roster leaves later slots empty, which is legal — a caller after only early-pick facts
   *  (survival odds) need not pay for a full draft's remaining rounds. */
  readonly rounds: number;
  /** This run's own seed — the same seed always deals the same archetypes and draws the same
   *  bot picks, so a sim's own numbers are exactly reproducible from `{config, seed}` alone. */
  readonly seed: number;
}

export interface RunOneDraftResult {
  readonly picks: readonly CompletedPick[];
  readonly rosters: Readonly<Record<string, readonly { readonly playerId: string; readonly position: string }[]>>;
}

function submit(state: DraftState, action: Parameters<typeof reduceDraft>[1]): DraftState {
  const admitted = admitCommand(state, action);
  if (!admitted.ok) throw new Error(`sim: ${action.type} refused at admit: ${admitted.reason}`);
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`sim: ${action.type} refused at reduce: ${result.reason}`);
  return result.state;
}

/** One full (or partial) headless snake draft. Throws only on a defect — a legitimate sim
 *  configuration never produces a refused command, by the module docblock's own reasoning. */
export function runOneDraft(input: RunOneDraftInput): RunOneDraftResult {
  const config: DraftConfig = {
    draftId: `sim_${input.seed}`,
    leagueId: "sim",
    format: "snake",
    kickoffAt: SIM_INSTANT,
    auctionBudget: null,
    slotConfig: input.rosterSlots,
    clockSchedule: [],
  };
  const start: StartDraftAction = {
    v: 1,
    type: "START_DRAFT",
    timestamp: SIM_INSTANT,
    draftOrder: input.teamIds,
    pool: input.board,
    minBid: 1,
  };
  let state = submit(initialDraftState(config), start);

  const archetypes = assignArchetypes(input.seed, input.teamIds);
  const lastPick = Math.min(input.rounds, totalRosterSlots(input.rosterSlots)) * input.teamIds.length;

  while (!isComplete(state) && state.pickNumber <= lastPick) {
    const teamId = teamOnClock(state);
    if (teamId === null) break; // defensive: cannot occur in a snake sim with no owed picks
    const archetype = archetypes[teamId]!;
    const rng = rngFor(input.seed, `${teamId}:pick:${state.pickNumber}`);
    const playerId = chooseBotPick(state, teamId, archetype, rng);
    if (playerId === null) break; // this seat's roster can legally take nothing left in the pool
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    state = submit(state, action);
  }

  const positionByPlayerId = new Map(input.board.map((entry) => [entry.playerId, entry.position] as const));
  const rosters = Object.fromEntries(
    input.teamIds.map((teamId) => [
      teamId,
      (state.rosters[teamId] ?? []).map((slot) => ({ playerId: slot.playerId!, position: positionByPlayerId.get(slot.playerId!)! })),
    ]),
  );
  return { picks: state.picks, rosters };
}
