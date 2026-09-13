// Measures the draft engine's autopick policy and the advisor's call on the real 2026 board.
// Run: dotenv -e .env.local -- tsx scripts/clock-pick-measure.ts [--runs 200] [--seed 20260912]
//      [--sharpness 0.5] [--advisor-runs 50] [--bench 6]
//
// Reads the store and nothing else: the room board is `players.adp` ascending, exactly the order
// `rankedPlayers` (`@/draft-service/pool`) snapshots into a real room's START_DRAFT, and the
// advisor values the PPR evidence board through `valuedEvidence` exactly as the room's service
// does. Every seat's pick goes through the real engine (`submit`, `@/draft-service/sim/run`).
//
// Three shapes, one seed each, all reproducible from the flags alone:
//   1. every seat picked by the clock policy (`bestAvailableFor` under `AUTOPICK_CONFIG`);
//   2. the incident shape: eleven practice bots and one autopick seat, rotating the seat;
//   3. one seat following the advisor's call (`recommendNow`) among eleven clock-picked seats.
// Run 0 of each shape is the exact board. Runs 1..N jitter the market the way the room simulator
// does (`simBoardOrder`, the sim's own "mixed" sharpness by default), because the autopick carries
// no RNG and two hundred drafts of one fixed board would be two hundred copies of one draft.
import { asc, isNotNull } from "drizzle-orm";
import { createDb } from "@/db/client";
import { players as playersTable } from "@/db/schema";
import type { DraftPoolEntry, MakePickAction, StartDraftAction } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import {
  AUTOPICK_CONFIG,
  bestAvailableFor,
  initialDraftState,
  isComplete,
  roundForPick,
  teamOnClock,
  totalRosterSlots,
  type CompletedPick,
  type DraftAutopickPolicy,
  type DraftConfig,
  type DraftState,
} from "@/draft-engine";
import { recommendNow, valuedEvidence, type ValuedEntry } from "@/draft-service/assistant/recommend";
import { simBoardOrder, type SimRankableEntry } from "@/draft-service/sim/board-order";
import { evidencePoolFor } from "@/draft-service/sim/evidence";
import { SIM_INSTANT, submit } from "@/draft-service/sim/run";
import { assignArchetypes, type BotArchetype } from "@/mock-draft/archetypes";
import { inferSeatDrivers } from "@/draft-service/sim/seat-model";
import { chooseBotPick } from "@/mock-draft/bots";
import { rngFor } from "@/mock-draft/rng";
import type { Recommendation } from "@/projections/decide/draft";
import type { LeagueShape } from "@/projections/decide/replacement";

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const TEAM_COUNT = 12;
const ADVISOR_SEAT_INDEX = 5;
const LATE_ROUND_FLOOR = 13;

interface Flags {
  readonly runs: number;
  readonly seed: number;
  readonly sharpness: number;
  readonly advisorRuns: number;
  readonly bench: number;
  readonly snapshot: DraftAutopickPolicy;
}

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number, got ${process.argv[index + 1]}`);
  return value;
}

/** `--snapshot legacy` starts every draft under the 2026-09-05 snapshot (surplus damp, no roster
 *  ceilings): the clock and the bots behave as a room opened before the 2026-09-12 ruling did. */
function snapshotFlag(): DraftAutopickPolicy {
  const index = process.argv.indexOf("--snapshot");
  const value = index === -1 ? "current" : process.argv[index + 1];
  if (value === "current") return AUTOPICK_CONFIG;
  if (value === "legacy") return Object.fromEntries(Object.entries(AUTOPICK_CONFIG).filter(([key]) => key !== "rosterCeilings")) as DraftAutopickPolicy;
  throw new Error(`--snapshot must be current or legacy, got ${value}`);
}

function readFlags(): Flags {
  return { runs: flag("runs", 200), seed: flag("seed", 20260912), sharpness: flag("sharpness", 0.5), advisorRuns: flag("advisor-runs", 50), bench: flag("bench", 6), snapshot: snapshotFlag() };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set. Run through \`dotenv -e .env.local -- tsx scripts/clock-pick-measure.ts\`.`);
  return value;
}

interface BoardPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly adp: number;
}

interface PickRecord {
  readonly pickNumber: number;
  readonly round: number;
  readonly teamId: string;
  readonly playerId: string;
  readonly position: Position;
  /** 0-based index on this run's board. */
  readonly boardIndex: number;
  /** True when the chosen player was not the first legal entry on the board. */
  readonly offBoardOrder: boolean;
}

interface RunRecord {
  readonly picks: readonly PickRecord[];
  /** Position -> round its first player sits in on this run's board. */
  readonly adpRoundByPosition: ReadonlyMap<Position, number>;
  /** The room as it stood entering round `INFERENCE_ROUND`, and at the end. */
  readonly midState: DraftState | null;
  readonly finalState: DraftState;
}

type Picker = (state: DraftState, teamId: string) => string | null;

/** The archetype inference is read entering this round (five rounds of picks per seat) and at the end. */
const INFERENCE_ROUND = 6;

function rosterSlotsWithBench(bench: number): readonly RosterSlotConfig[] {
  return STANDARD_ROSTER_SLOTS.map((slot) => (slot.slot === BENCH_SLOT ? { ...slot, count: bench } : slot));
}

function firstLegalOnBoard(state: DraftState, teamId: string): string | null {
  const legacy: DraftState = { ...state, config: { ...state.config, autopick: undefined } };
  return bestAvailableFor(legacy, teamId)?.playerId ?? null;
}

function adpRounds(board: readonly DraftPoolEntry[]): ReadonlyMap<Position, number> {
  const rounds = new Map<Position, number>();
  board.forEach((entry, index) => {
    if (!rounds.has(entry.position)) rounds.set(entry.position, Math.floor(index / TEAM_COUNT) + 1);
  });
  return rounds;
}

function runDraft(board: readonly DraftPoolEntry[], rosterSlots: readonly RosterSlotConfig[], teamIds: readonly string[], pickerFor: (teamId: string) => Picker, seed: number, snapshot: DraftAutopickPolicy): RunRecord {
  const config: DraftConfig = { draftId: `measure_${seed}`, leagueId: "measure", format: "snake", kickoffAt: SIM_INSTANT, auctionBudget: null, slotConfig: rosterSlots, clockSchedule: [] };
  const start: StartDraftAction = { v: 1, type: "START_DRAFT", timestamp: SIM_INSTANT, draftOrder: teamIds, pool: board, minBid: 1, autopick: snapshot };
  let state = submit(initialDraftState(config), start);
  const indexOf = new Map(board.map((entry, index) => [entry.playerId, index] as const));
  const positionOf = new Map(board.map((entry) => [entry.playerId, entry.position] as const));
  const picks: PickRecord[] = [];
  let midState: DraftState | null = null;
  while (!isComplete(state)) {
    const teamId = teamOnClock(state);
    if (teamId === null) break;
    if (midState === null && roundForPick(teamIds.length, state.pickNumber) === INFERENCE_ROUND) midState = state;
    const playerId = pickerFor(teamId)(state, teamId);
    if (playerId === null) break;
    const boardFirst = firstLegalOnBoard(state, teamId);
    const action: MakePickAction = { v: 1, type: "MAKE_PICK", timestamp: SIM_INSTANT, teamId, playerId };
    state = submit(state, action);
    const pick: CompletedPick = state.picks[state.picks.length - 1]!;
    picks.push({ pickNumber: pick.pickNumber, round: pick.round, teamId, playerId, position: positionOf.get(playerId)!, boardIndex: indexOf.get(playerId)!, offBoardOrder: boardFirst !== playerId });
  }
  return { picks, adpRoundByPosition: adpRounds(board), midState, finalState: state };
}

interface InferenceTally {
  readonly seats: number;
  readonly correct: number;
  readonly prior: number;
  readonly wrong: number;
}

/** How the opponent model reads the bots' dealt archetypes from their own picks, at one state. */
function tallyInference(state: DraftState | null, dealt: Readonly<Record<string, BotArchetype>>, botSeats: readonly string[], into: InferenceTally): InferenceTally {
  if (state === null) return into;
  const drivers = inferSeatDrivers(state);
  return botSeats.reduce((tally, teamId) => {
    const driver = drivers[teamId];
    if (driver === undefined || driver.kind !== "archetype") return tally;
    if (driver.basis === "prior") return { ...tally, seats: tally.seats + 1, prior: tally.prior + 1 };
    return driver.archetype.name === dealt[teamId]!.name ? { ...tally, seats: tally.seats + 1, correct: tally.correct + 1 } : { ...tally, seats: tally.seats + 1, wrong: tally.wrong + 1 };
  }, into);
}

const EMPTY_TALLY: InferenceTally = { seats: 0, correct: 0, prior: 0, wrong: 0 };

function describeTally(label: string, tally: InferenceTally): string {
  return `${label}: ${tally.seats} bot seats, read correctly ${pct(tally.correct, tally.seats)}, still on the prior ${pct(tally.prior, tally.seats)}, read as another brain ${pct(tally.wrong, tally.seats)}`;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmt(value: number, digits = 2): string {
  return Number.isNaN(value) ? "none" : value.toFixed(digits);
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "none" : `${((100 * numerator) / denominator).toFixed(1)}%`;
}

interface PositionSummary {
  readonly position: Position;
  readonly meanPerTeam: number;
  readonly histogram: ReadonlyMap<number, number>;
  readonly roomFirstRound: number;
  readonly adpRound: number;
  readonly teamFirstRound: number;
  readonly teamSecondRound: number;
  readonly teamThirdRound: number;
  readonly meanReachRounds: number;
  readonly offBoardOrderShare: string;
}

function summarizePosition(runs: readonly RunRecord[], position: Position, teamIds: readonly string[]): PositionSummary {
  const histogram = new Map<number, number>();
  const firstRounds: number[] = [];
  const secondRounds: number[] = [];
  const thirdRounds: number[] = [];
  const roomFirst: number[] = [];
  const adpRound: number[] = [];
  const reaches: number[] = [];
  let offOrder = 0;
  let total = 0;
  for (const run of runs) {
    const atPosition = run.picks.filter((pick) => pick.position === position);
    roomFirst.push(atPosition[0]?.round ?? Number.NaN);
    adpRound.push(run.adpRoundByPosition.get(position) ?? Number.NaN);
    for (const pick of atPosition) {
      reaches.push(pick.round - (Math.floor(pick.boardIndex / TEAM_COUNT) + 1));
      total += 1;
      if (pick.offBoardOrder) offOrder += 1;
    }
    for (const teamId of teamIds) {
      const own = atPosition.filter((pick) => pick.teamId === teamId).sort((a, b) => a.pickNumber - b.pickNumber);
      histogram.set(own.length, (histogram.get(own.length) ?? 0) + 1);
      if (own[0] !== undefined) firstRounds.push(own[0].round);
      if (own[1] !== undefined) secondRounds.push(own[1].round);
      if (own[2] !== undefined) thirdRounds.push(own[2].round);
    }
  }
  return {
    position,
    meanPerTeam: mean([...histogram].flatMap(([count, teams]) => Array<number>(teams).fill(count))),
    histogram,
    roomFirstRound: mean(roomFirst.filter((round) => !Number.isNaN(round))),
    adpRound: mean(adpRound.filter((round) => !Number.isNaN(round))),
    teamFirstRound: mean(firstRounds),
    teamSecondRound: mean(secondRounds),
    teamThirdRound: mean(thirdRounds),
    meanReachRounds: mean(reaches),
    offBoardOrderShare: pct(offOrder, total),
  };
}

function teamRunsWith(runs: readonly RunRecord[], teamIds: readonly string[], test: (own: readonly PickRecord[]) => boolean): number {
  let count = 0;
  for (const run of runs) for (const teamId of teamIds) if (test(run.picks.filter((pick) => pick.teamId === teamId))) count += 1;
  return count;
}

function printShape(title: string, runs: readonly RunRecord[], teamIds: readonly string[], onlyTeam: string | null): void {
  const teams = onlyTeam === null ? teamIds : [onlyTeam];
  const teamRuns = runs.length * teams.length;
  console.log(`\n### ${title} (${runs.length} drafts, ${teamRuns} team-drafts)\n`);
  console.log("| Pos | mean/team | count histogram (n teams) | room first rd | ADP rd | team 1st rd | team 2nd rd | team 3rd rd | mean reach rds | picks off board order |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  const scoped = onlyTeam === null ? runs : runs.map((run) => ({ ...run, picks: run.picks.filter((pick) => pick.teamId === onlyTeam) }));
  for (const position of POSITIONS) {
    const s = summarizePosition(scoped, position, teams);
    const hist = [...s.histogram].sort((a, b) => a[0] - b[0]).map(([count, n]) => `${count}:${n}`).join(" ");
    console.log(`| ${position} | ${fmt(s.meanPerTeam)} | ${hist} | ${fmt(s.roomFirstRound, 1)} | ${fmt(s.adpRound, 1)} | ${fmt(s.teamFirstRound, 1)} | ${fmt(s.teamSecondRound, 1)} | ${fmt(s.teamThirdRound, 1)} | ${fmt(s.meanReachRounds)} | ${s.offBoardOrderShare} |`);
  }
  const count = (position: Position, own: readonly PickRecord[]): number => own.filter((pick) => pick.position === position).length;
  const before13 = (position: Position, own: readonly PickRecord[]): boolean => own.some((pick) => pick.position === position && pick.round < LATE_ROUND_FLOOR);
  const rows: readonly (readonly [string, (own: readonly PickRecord[]) => boolean])[] = [
    ["3 or more QB", (own) => count("QB", own) >= 3],
    ["2 or more QB", (own) => count("QB", own) >= 2],
    ["2 or more TE", (own) => count("TE", own) >= 2],
    ["3 or more TE", (own) => count("TE", own) >= 3],
    [`K before round ${LATE_ROUND_FLOOR}`, (own) => before13("K", own)],
    [`D/ST before round ${LATE_ROUND_FLOOR}`, (own) => before13("DEF", own)],
  ];
  console.log("\n| Teams holding | team-drafts | share |");
  console.log("|---|---|---|");
  for (const [label, test] of rows) {
    const n = teamRunsWith(runs, teams, test);
    console.log(`| ${label} | ${n} | ${pct(n, teamRuns)} |`);
  }
}

function printRosterSheet(run: RunRecord, teamIds: readonly string[], names: ReadonlyMap<string, string>): void {
  console.log("\n| Seat | QB | RB | WR | TE | K | DEF | picks in order (round:pos) |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const teamId of teamIds) {
    const own = run.picks.filter((pick) => pick.teamId === teamId).sort((a, b) => a.pickNumber - b.pickNumber);
    const counts = POSITIONS.map((position) => own.filter((pick) => pick.position === position).length);
    console.log(`| ${teamId} | ${counts.join(" | ")} | ${own.map((pick) => `${pick.round}:${pick.position}`).join(" ")} |`);
  }
  const qbHeavy = teamIds.filter((teamId) => run.picks.filter((pick) => pick.teamId === teamId && pick.position === "QB").length >= 3);
  for (const teamId of qbHeavy) {
    const qbs = run.picks.filter((pick) => pick.teamId === teamId && pick.position === "QB").map((pick) => `${pick.round}.${String(((pick.pickNumber - 1) % TEAM_COUNT) + 1).padStart(2, "0")} ${names.get(pick.playerId)} (ADP idx ${pick.boardIndex + 1})`);
    console.log(`\n${teamId} quarterbacks: ${qbs.join("; ")}`);
  }
}

interface AdvisorTurn {
  readonly round: number;
  readonly top: Recommendation | null;
  readonly rawTop: Recommendation | null;
  readonly vorTop: Recommendation | null;
  readonly flip: boolean;
  readonly tierFlip: boolean;
  readonly emptyWithOpenSlots: boolean;
}

function hasCliff(rec: Recommendation | null): boolean {
  return rec?.reasons.some((reason) => reason.code === "tier_cliff") ?? false;
}

function advisorTurn(state: DraftState, teamId: string, valued: ReadonlyMap<string, ValuedEntry>, shape: LeagueShape): AdvisorTurn {
  // The room's own depth (`ADVISOR_CONFIG.shortlistSize`): the highest roster-fit candidate is
  // always inside the considered set, so the flip read needs nothing deeper.
  const recs = recommendNow({ state, askingTeamId: teamId, valued, shape });
  const top = recs[0] ?? null;
  const rawTop = [...recs].sort((a, b) => b.rosterAdjustedValue - a.rosterAdjustedValue || b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId))[0] ?? null;
  const vorTop = [...recs].sort((a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId))[0] ?? null;
  const flip = top !== null && rawTop !== null && top.playerId !== rawTop.playerId;
  return { round: roundForPick(TEAM_COUNT, state.pickNumber), top, rawTop, vorTop, flip, tierFlip: flip && hasCliff(top) && !hasCliff(rawTop), emptyWithOpenSlots: top === null && (state.rosters[teamId]?.length ?? 0) < totalRosterSlots(state.config.slotConfig) };
}

function describe(rec: Recommendation | null, names: ReadonlyMap<string, string>): string {
  if (rec === null) return "nobody";
  return `${names.get(rec.playerId) ?? rec.playerId} ${rec.position} fit ${rec.rosterAdjustedValue.toFixed(1)} EV ${rec.expectedValueAdded.toFixed(1)} [${rec.reasons.map((reason) => reason.code).join(",")}]`;
}

async function main(): Promise<void> {
  const flags = readFlags();
  const db = createDb(requireEnv("DATABASE_URL"), { max: 2 });
  try {
    const rows = await db
      .select({ playerId: playersTable.id, name: playersTable.name, position: playersTable.position, adp: playersTable.adp })
      .from(playersTable)
      .where(isNotNull(playersTable.adp))
      .orderBy(asc(playersTable.adp), asc(playersTable.id));
    const board: readonly BoardPlayer[] = rows.map((row) => ({ playerId: row.playerId, name: row.name, position: row.position, adp: row.adp! }));
    const names = new Map(board.map((player) => [player.playerId, player.name] as const));
    const exactBoard: readonly DraftPoolEntry[] = board.map(({ playerId, position }) => ({ playerId, position }));
    const rankable: readonly SimRankableEntry[] = board.map(({ playerId, position }, index) => ({ playerId, position, evidenceRank: index, marketRank: index }));
    const rosterSlots = rosterSlotsWithBench(flags.bench);
    const teamIds = Array.from({ length: TEAM_COUNT }, (_, i) => `seat_${i + 1}`);
    const { pool, boardGeneration } = await evidencePoolFor(db);
    const shape: LeagueShape = { teamCount: TEAM_COUNT, rosterSlots };
    const valued = valuedEvidence(pool, shape);
    const boardFor = (run: number): readonly DraftPoolEntry[] => (run === 0 ? exactBoard : simBoardOrder(rankable, flags.sharpness, rngFor(flags.seed + run, "board-order")));

    console.log(`## Clock-pick measurement, ${new Date().toISOString()}`);
    console.log(`Board: ${board.length} players with an ADP (players.adp ascending), positions ${POSITIONS.map((position) => `${position} ${board.filter((player) => player.position === position).length}`).join(", ")}.`);
    console.log(`Evidence board: ${pool.length} projected rows, generation ${boardGeneration}, valued positions ${[...new Set([...valued.values()].map((entry) => entry.position))].join("/")}.`);
    console.log(`Shape: ${TEAM_COUNT} teams, ${totalRosterSlots(rosterSlots)} rounds (bench ${flags.bench}). Seed ${flags.seed}, sharpness ${flags.sharpness}, runs ${flags.runs}, advisor runs ${flags.advisorRuns}.`);
    console.log(`Snapshot on every START_DRAFT (${flags.snapshot.rosterCeilings === undefined ? "legacy, no roster ceilings" : "current"}): ${JSON.stringify(flags.snapshot)}`);

    const autopick: Picker = (state, teamId) => bestAvailableFor(state, teamId)?.playerId ?? null;

    const allAutopick: RunRecord[] = [];
    for (let run = 0; run <= flags.runs; run += 1) allAutopick.push(runDraft(boardFor(run), rosterSlots, teamIds, () => autopick, flags.seed + run, flags.snapshot));
    console.log("\n## Shape 1: every seat picked by the clock policy");
    console.log("\nRun 0, the exact board:");
    printRosterSheet(allAutopick[0]!, teamIds, names);
    printShape("Shape 1, all runs", allAutopick, teamIds, null);
    console.log("\nTier-drop flips in the clock pick: 0 of every pick by construction. `bestAvailableFor` (src/draft-engine/selectors.ts) scores rankWeight x needMultiplier and carries no tier term; the last column above is the share of picks the NEED term moved off plain board order.");

    const incident: RunRecord[] = [];
    let midTally = EMPTY_TALLY;
    let finalTally = EMPTY_TALLY;
    for (let run = 0; run <= flags.runs; run += 1) {
      const seed = flags.seed + run;
      const autoSeat = teamIds[run % TEAM_COUNT]!;
      const archetypes = assignArchetypes(seed, teamIds);
      const pickerFor = (teamId: string): Picker => (teamId === autoSeat ? autopick : (state, id) => chooseBotPick(state, id, archetypes[id]!, rngFor(seed, `${id}:pick:${state.pickNumber}`)));
      const record = runDraft(boardFor(run), rosterSlots, teamIds, pickerFor, seed, flags.snapshot);
      const botSeats = teamIds.filter((teamId) => teamId !== autoSeat);
      midTally = tallyInference(record.midState, archetypes, botSeats, midTally);
      finalTally = tallyInference(record.finalState, archetypes, botSeats, finalTally);
      incident.push({ ...record, picks: record.picks.map((pick) => ({ ...pick, teamId: pick.teamId === autoSeat ? "clock_seat" : pick.teamId })) });
    }
    console.log("\n## Shape 2: the incident shape, eleven practice bots and one clock-picked seat (rotating)");
    printShape("Shape 2, the clock-picked seat only", incident, ["clock_seat"], "clock_seat");
    printShape("Shape 2, the eleven practice bots", incident, teamIds, null);
    console.log(`\nOpponent model, the bots' dealt archetypes read back from their own picks (\`inferSeatDrivers\`):\n- ${describeTally(`entering round ${INFERENCE_ROUND}`, midTally)}\n- ${describeTally("at the end of the draft", finalTally)}`);

    const advisorSeat = teamIds[ADVISOR_SEAT_INDEX]!;
    const measureAdvisor = (label: string, othersFor: (run: number) => (teamId: string) => Picker): void => {
      const advisorTurns: AdvisorTurn[] = [];
      const advisorRuns: RunRecord[] = [];
      const startedAt = Date.now();
      for (let run = 0; run <= flags.advisorRuns; run += 1) {
        const turns: AdvisorTurn[] = [];
        const follow: Picker = (state, teamId) => {
          const turn = advisorTurn(state, teamId, valued, shape);
          turns.push(turn);
          return turn.top?.playerId ?? autopick(state, teamId);
        };
        const others = othersFor(run);
        advisorRuns.push(runDraft(boardFor(run), rosterSlots, teamIds, (teamId) => (teamId === advisorSeat ? follow : others(teamId)), flags.seed + run, flags.snapshot));
        if (run === 0) {
          console.log(`\n## ${label}\n\nRun 0, the exact board, ${advisorSeat}'s turns:\n`);
          console.log("| Rd | advisor's call | highest roster-fit value | highest VOR | flip | tier flip |");
          console.log("|---|---|---|---|---|---|");
          for (const turn of turns) console.log(`| ${turn.round} | ${describe(turn.top, names)} | ${describe(turn.rawTop, names)} | ${describe(turn.vorTop, names)} | ${turn.flip ? "yes" : "no"} | ${turn.tierFlip ? "yes" : "no"} |`);
        }
        advisorTurns.push(...turns);
      }
      console.log(`\nAdvisor compute: ${advisorTurns.length} turns in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
      printShape(`${label}, ${advisorSeat} only`, advisorRuns, [advisorSeat], advisorSeat);
      const flips = advisorTurns.filter((turn) => turn.flip).length;
      const tierFlips = advisorTurns.filter((turn) => turn.tierFlip).length;
      const empty = advisorTurns.filter((turn) => turn.emptyWithOpenSlots).length;
      const teFlips = advisorTurns.filter((turn) => turn.flip && turn.top?.position === "TE").length;
      const zeroTies = advisorTurns.filter((turn) => turn.top !== null && turn.top.expectedValueAdded === 0).length;
      const cliffLed = advisorTurns.filter((turn) => turn.top?.reasons[0]?.code === "tier_cliff").length;
      console.log(`\nAdvisor turns ${advisorTurns.length}: call differs from highest roster-fit value in ${flips} (${pct(flips, advisorTurns.length)}); of those the call carries a tier cliff the value leader does not in ${tierFlips} (${pct(tierFlips, advisorTurns.length)}); the call is a TE against a non-TE value leader in ${teFlips}; the call's leading reason is the tier cliff in ${cliffLed} (${pct(cliffLed, advisorTurns.length)}); the call's expected value is exactly 0 (an exact tie, ordered by bench depth then ADP) in ${zeroTies} (${pct(zeroTies, advisorTurns.length)}); empty shortlist with open roster slots in ${empty} (${pct(empty, advisorTurns.length)}).`);
      const emptyRounds = new Map<number, number>();
      for (const turn of advisorTurns) if (turn.emptyWithOpenSlots) emptyRounds.set(turn.round, (emptyRounds.get(turn.round) ?? 0) + 1);
      if (emptyRounds.size > 0) console.log(`Empty-shortlist turns by round: ${[...emptyRounds].sort((a, b) => a[0] - b[0]).map(([round, n]) => `${round}:${n}`).join(" ")}`);
      console.log("\nThe call's position by round (share of runs):\n");
      console.log(`| Rd | ${POSITIONS.join(" | ")} | nobody |`);
      console.log(`|---|${POSITIONS.map(() => "---").join("|")}|---|`);
      const rounds = [...new Set(advisorTurns.map((turn) => turn.round))].sort((a, b) => a - b);
      for (const round of rounds) {
        const atRound = advisorTurns.filter((turn) => turn.round === round);
        const cells = POSITIONS.map((position) => pct(atRound.filter((turn) => turn.top?.position === position).length, atRound.length));
        console.log(`| ${round} | ${cells.join(" | ")} | ${pct(atRound.filter((turn) => turn.top === null).length, atRound.length)} |`);
      }
    };
    measureAdvisor(`Shape 3: ${advisorSeat} follows the advisor's call, eleven clock-picked seats`, () => () => autopick);
    measureAdvisor(`Shape 4: ${advisorSeat} follows the advisor's call, eleven practice bots`, (run) => {
      const seed = flags.seed + run;
      const archetypes = assignArchetypes(seed, teamIds);
      return (teamId) => (state, id) => chooseBotPick(state, id, archetypes[teamId]!, rngFor(seed, `${id}:pick:${state.pickNumber}`));
    });
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
