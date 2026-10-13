/**
 * The frozen continuation fixture for the Go engine port (Lane 4): one recorded room, stopped with a
 * human on the clock in round five, its seats read by the seat model, then 1,000 seeded continuations
 * of it through the TypeScript sim (`simulateRoomOdds`, seeds `seed + run`), with every seat's survival
 * and seats-ahead table; and the report's runs (the same room from pick one, the humans on autopick)
 * played to the end and graded.
 *
 *   npx tsx scripts/export-continue-fixture.ts
 *
 * Writes `api/testdata/sim/continue-1000.json`. Run once; never regenerated to make a test pass.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftPoolEntry } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { availablePool, assignSlot, reduceDraft, replayDraft, rosterFor, teamOnClock, totalPickCount, type DraftState } from "@/draft-engine";
import { gradeDraft } from "@/draft-service/grades/engine";
import { continueRoom } from "@/draft-service/sim/continue";
import { seatsAheadFor, simulateRoomOdds, survivalFor } from "@/draft-service/sim/room-odds";
import { inferSeatDrivers, type SeatDrivers } from "@/draft-service/sim/seat-model";
import { TESTDATA, loadBoard, loadByes, recordRoom } from "./engine-fixture-room";

const RUNS = 1000;
const REPORT_RUNS = 200;

const board = loadBoard();
const pool: readonly DraftPoolEntry[] = board.map((p) => ({ playerId: p.playerId, position: p.position }));
const teams = Array.from({ length: 12 }, (_, i) => `seat${String(i + 1).padStart(2, "0")}`);
const humans = ["seat03", "seat10"];
const room = recordRoom({
  name: "continue", seed: 2026_10_12, teams, humans, pool, slotConfig: STANDARD_ROSTER_SLOTS,
  clockSeconds: 60, startedAt: "2026-08-15T18:00:00.000Z", stopAtHumanPick: 52,
});
const state = room.state;
const onClock = teamOnClock(state)!;
const exclude = new Set(
  availablePool(state)
    .filter((e) => assignSlot({ position: e.position, roster: rosterFor(state, onClock), slotConfig: state.config.slotConfig }).ok)
    .slice(0, 3)
    .map((e) => e.playerId),
);
const drivers = inferSeatDrivers(state);
const seed = 99_000_001;
const table = simulateRoomOdds({ state, seed, runs: RUNS, drivers, excludeFromOnClockSeat: exclude });
const seats = teams.map((teamId) => {
  const survival = survivalFor(table, state, teamId);
  return {
    teamId,
    survival: survival === null ? null : { pickNumber: survival.pickNumber, runsReached: survival.runsReached, survived: Object.fromEntries(survival.survived) },
    seatsAhead: seatsAheadFor(table, state, teamId),
  };
});

// The report's runs: from pick one, the humans on the clock's own policy, every bot reshuffled per run.
const started = replayDraft(room.config, room.actions.slice(0, 1));
const reportDrivers: SeatDrivers = Object.fromEntries(humans.map((teamId) => [teamId, { kind: "autopick", picksObserved: 0 } as const]));
const points = new Map(board.filter((p) => p.points !== null).map((p) => [p.playerId, p.points!] as const));
const values = new Map(board.filter((p) => p.value !== null).map((p) => [p.playerId, p.value!] as const));
const byes = new Map(Object.entries(loadByes()));
const nflTeams = new Map(board.map((p) => [p.playerId, p.nflTeam] as const));
const positions = new Map(board.map((p) => [p.playerId, p.position] as const));
const reportRuns = Array.from({ length: REPORT_RUNS }, (_, run) => {
  const result = continueRoom({ state: started, seed: seed + run, throughPick: totalPickCount(started), excludeFromOnClockSeat: new Set(), drivers: reportDrivers });
  let final: DraftState = started;
  for (const pick of result.played) {
    const next = reduceDraft(final, { v: 1, type: "MAKE_PICK", timestamp: final.turnStartedAt!, teamId: pick.teamId, playerId: pick.playerId });
    if (!next.ok) throw new Error(next.reason);
    final = next.state;
  }
  const rosters = new Map(teams.map((teamId) => [teamId, rosterFor(final, teamId).map((slot) => ({ playerId: slot.playerId!, position: positions.get(slot.playerId!)! as Position }))]));
  const grades = gradeDraft({ picks: final.picks, rosters, slotConfig: STANDARD_ROSTER_SLOTS, pointsByPlayerId: points, valueByPlayerId: values, byeWeeks: byes, nflTeamByPlayerId: nflTeams });
  return {
    played: result.played.map((p) => p.playerId).join(","),
    grades: grades.map((g) => ({ teamId: g.teamId, projectedRank: g.projectedRank, ...g.components })),
  };
});

const fixture = {
  source: "scripts/export-continue-fixture.ts through src/draft-service/sim (simulateRoomOdds, continueRoom, inferSeatDrivers, gradeDraft)",
  room: { config: room.config, actions: room.actions.map((a) => (a.type === "START_DRAFT" ? { ...a, pool: "$board" } : a)) },
  board: pool,
  seed,
  onClock,
  exclude: [...exclude],
  drivers,
  table: { runs: table.runs, fromPick: table.fromPick, throughPick: table.throughPick, played: table.played.map((run) => run.map((p) => p.playerId).join(",")) },
  seats,
  report: { seed, runs: REPORT_RUNS, humans, points: Object.fromEntries(points), values: Object.fromEntries(values), byes: Object.fromEntries(byes), nflTeams: Object.fromEntries(nflTeams), results: reportRuns },
};
writeFileSync(join(TESTDATA, "sim", "continue-1000.json"), `${JSON.stringify(fixture)}\n`);
console.log(`room at pick ${state.pickNumber}, ${onClock} on the clock; ${RUNS} runs through ${table.throughPick}; ${REPORT_RUNS} report runs`);
console.log(Object.entries(drivers).map(([t, d]) => `${t}:${d.kind === "autopick" ? "autopick" : `${d.archetype.name}/${d.basis}`}`).join(" "));
