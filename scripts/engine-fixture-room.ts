/**
 * The recorded rooms the Go engine port (Lane 4) is checked against, played through the TypeScript
 * engine exactly the way a mock room's server drove it (`src/mock-draft-service/driver.ts`,
 * `src/draft-service/store.ts`): START_DRAFT stamped with today's snapshots, every bot pick drawn
 * from `rngFor(seed, teamId)` positioned by the bot's own earlier draws and stamped at the first
 * whole millisecond after its seeded think delay, and the human seats acting by a seeded script
 * (a pick a few rows down the board, a queue, a clock that runs out). Shared by
 * `export-continue-fixture.ts` and `export-mock-logs.ts`; never imported by the app.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import {
  AUTOPICK_CONFIG,
  DRAFT_SKIP_POLICY,
  admitCommand,
  availablePool,
  assignSlot,
  currentClockSeconds,
  currentDeadline,
  initialDraftState,
  reduceDraft,
  rosterFor,
  teamOnClock,
  type DraftConfig,
  type DraftState,
} from "@/draft-engine";
import { assignArchetypes } from "@/mock-draft/archetypes";
import { botDelayStreamKey, botThinkDelayMs, chooseBotPick } from "@/mock-draft/bots";
import { createSeededRng, rngFor, type Rng } from "@/mock-draft/rng";

export const TESTDATA = join(process.cwd(), "api", "testdata");

export interface BoardPlayer {
  readonly playerId: string;
  readonly position: DraftPoolEntry["position"];
  readonly nflTeam: string;
  readonly points: number | null;
  readonly value: number | null;
}

/** `api/testdata/sim/board-2026.json`: the dev database's board, exported once, read-only. */
export function loadBoard(): readonly BoardPlayer[] {
  return (JSON.parse(readFileSync(join(TESTDATA, "sim", "board-2026.json"), "utf8")) as { players: BoardPlayer[] }).players;
}

export function loadByes(): Readonly<Record<string, number>> {
  return JSON.parse(readFileSync(join(TESTDATA, "sim", "byes-2026.json"), "utf8")) as Record<string, number>;
}

export interface RoomPlan {
  readonly name: string;
  readonly seed: number;
  readonly teams: readonly string[];
  readonly humans: readonly string[];
  readonly pool: readonly DraftPoolEntry[];
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly clockSeconds: number;
  readonly startedAt: string;
  /** Stop once the draft reaches this pick with a human on the clock (or at the end). */
  readonly stopAtHumanPick?: number;
}

export interface RecordedRoom {
  readonly plan: RoomPlan;
  readonly config: DraftConfig;
  readonly actions: readonly DraftAction[];
  readonly state: DraftState;
}

function submit(state: DraftState, action: DraftAction): DraftState {
  const admitted = admitCommand(state, action);
  if (!admitted.ok) throw new Error(`refused at admit: ${admitted.reason}`);
  const result = reduceDraft(state, action);
  if (!result.ok) throw new Error(`refused at reduce: ${result.reason}`);
  return result.state;
}

/** The driver's pick stream: draw N of `rngFor(seed, teamId)` for the bot's Nth sampled pick. */
function pickStream(seed: number, teamId: string, state: DraftState): Rng {
  const rng = rngFor(seed, teamId);
  const prior = state.picks.filter((pick) => pick.teamId === teamId && !pick.auto).length;
  for (let i = 0; i < prior; i += 1) rng.next();
  return rng;
}

/** The human seats' script: mostly a pick a few rows down, sometimes a queue, sometimes the clock. */
function humanAction(state: DraftState, teamId: string, script: Rng): readonly DraftAction[] {
  const turnMs = Date.parse(state.turnStartedAt!);
  const roll = script.next();
  if (roll < 0.15) return [{ v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state)! }];
  const legal = availablePool(state).filter((entry) => assignSlot({ position: entry.position, roster: rosterFor(state, teamId), slotConfig: state.config.slotConfig }).ok);
  const stamp = (offset: number): string => new Date(turnMs + offset).toISOString();
  if (roll < 0.3) {
    const queue = legal.slice(2, 6).map((entry) => entry.playerId);
    return [
      { v: 1, type: "SET_QUEUE", timestamp: stamp(1500), teamId, playerIds: queue },
      { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state)! },
    ];
  }
  const pick = legal[Math.min(legal.length - 1, Math.floor(script.next() * 5))]!;
  return [{ v: 1, type: "MAKE_PICK", timestamp: stamp(2000 + Math.floor(script.next() * 9000)), teamId, playerId: pick.playerId }];
}

export function recordRoom(plan: RoomPlan): RecordedRoom {
  const config: DraftConfig = {
    draftId: `d_${plan.name}`,
    leagueId: `l_${plan.name}`,
    format: "snake",
    kickoffAt: plan.startedAt,
    auctionBudget: null,
    slotConfig: plan.slotConfig,
    clockSchedule: [{ untilHoursBeforeKickoff: 0, pickSeconds: plan.clockSeconds }],
    pauseWindow: null,
    isMock: true,
  };
  const humans = new Set(plan.humans);
  const botIds = plan.teams.filter((team) => !humans.has(team)).sort();
  const archetypes = assignArchetypes(plan.seed, botIds);
  const script = createSeededRng(plan.seed ^ 0x5eed);
  const start: DraftAction = {
    v: 1, type: "START_DRAFT", timestamp: plan.startedAt, draftOrder: plan.teams, pool: plan.pool,
    minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, autopick: AUTOPICK_CONFIG,
  };
  const actions: DraftAction[] = [start];
  let state = submit(initialDraftState(config), start);
  while (state.phase === "in_progress") {
    const teamId = teamOnClock(state)!;
    if (humans.has(teamId)) {
      if (plan.stopAtHumanPick !== undefined && state.pickNumber >= plan.stopAtHumanPick) break;
      for (const action of humanAction(state, teamId, script)) {
        state = submit(state, action);
        actions.push(action);
      }
      continue;
    }
    const delay = botThinkDelayMs(currentClockSeconds(state)!, rngFor(plan.seed, botDelayStreamKey(teamId, state.pickNumber)));
    const playerId = chooseBotPick(state, teamId, archetypes[teamId]!, pickStream(plan.seed, teamId, state));
    if (playerId === null) throw new Error(`bot ${teamId} has no pick at ${state.pickNumber}`);
    const action: DraftAction = {
      v: 1, type: "MAKE_PICK", timestamp: new Date(Math.ceil(Date.parse(state.turnStartedAt!) + delay)).toISOString(), teamId, playerId,
    };
    state = submit(state, action);
    actions.push(action);
  }
  return { plan, config, actions, state };
}
