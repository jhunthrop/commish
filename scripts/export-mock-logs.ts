/**
 * The mock action logs the Go engine port replays to the same final state (Lane 4).
 *
 *   npx tsx scripts/export-mock-logs.ts
 *
 * The brief asks for every 2026 mock action log in the dev database. On 2026-10-12 the dev copy held
 * none (`draft_actions` and `mock_rooms` are empty: the retention sweep clears a mock a day after it
 * ends), so these logs are recorded instead, through the TypeScript engine and the mock room's own
 * driving rules (`engine-fixture-room.ts`), on the real 2026 board, across every shape the setup
 * screen offers. Writes `api/testdata/mocks/logs.json`: the board once, then per room its config, its
 * actions (START_DRAFT's pool written as "$board" plus the ids it marks off the autopick) and its
 * final state as `JSON.stringify` writes it, the pool left out.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftPoolEntry } from "@/domain/draft";
import type { RosterSlotConfig } from "@/domain/roster";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { TESTDATA, loadBoard, recordRoom, type RoomPlan } from "./engine-fixture-room";

const SUPERFLEX: readonly RosterSlotConfig[] = [
  ...STANDARD_ROSTER_SLOTS.slice(0, 5),
  { slot: "SUPERFLEX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  ...STANDARD_ROSTER_SLOTS.slice(5),
];
const TWO_FLEX: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.map((row) => (row.slot === "FLEX" ? { ...row, count: 2 } : row));
const NO_KICKER_DEEP: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 3, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BENCH", count: 8, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];
const SHAPES = [["standard", STANDARD_ROSTER_SLOTS], ["superflex", SUPERFLEX], ["two_flex", TWO_FLEX], ["no_kicker_deep", NO_KICKER_DEEP]] as const;

const board = loadBoard();
const plainPool: readonly DraftPoolEntry[] = board.map((p) => ({ playerId: p.playerId, position: p.position }));
/** Every 37th player marked off an active roster, so the autopick gate is exercised. */
const gatedIds = new Set(board.filter((_, i) => i % 37 === 11).map((p) => p.playerId));
const gatedPool: readonly DraftPoolEntry[] = plainPool.map((e) => (gatedIds.has(e.playerId) ? { ...e, excludedFromAutopick: true } : e));

function teams(count: number): readonly string[] {
  return Array.from({ length: count }, (_, i) => `seat${String(i + 1).padStart(2, "0")}`);
}

const plans: RoomPlan[] = [];
const teamCounts = [8, 10, 12, 14] as const;
const clocks = [30, 60, 90] as const;
for (let i = 0; i < 24; i += 1) {
  const count = teamCounts[i % teamCounts.length]!;
  const roster = teams(count);
  const [shapeName, shape] = SHAPES[Math.floor(i / 4) % SHAPES.length]!;
  const humans = i % 5 === 4 ? [roster[0]!, roster[count - 1]!] : [roster[(i * 5) % count]!];
  plans.push({
    name: `mock${String(i + 1).padStart(2, "0")}_${count}t_${shapeName}`,
    seed: (2026_10_12 * (i + 7)) % 4_294_967_296,
    teams: roster,
    humans,
    pool: i % 3 === 2 ? gatedPool : plainPool,
    slotConfig: shape,
    clockSeconds: clocks[i % clocks.length]!,
    startedAt: new Date(Date.UTC(2026, 7, 1 + i, 18, 0, 0, 0)).toISOString(),
  });
}
// Two rooms at a four-hour clock, so the skip-and-owe path, redemption and the catch-up turns replay too.
for (let i = 0; i < 2; i += 1) {
  const roster = teams(10);
  plans.push({
    name: `slow${i + 1}_10t_standard`, seed: 777_000 + i, teams: roster, humans: [roster[2]!, roster[7]!],
    pool: plainPool, slotConfig: STANDARD_ROSTER_SLOTS, clockSeconds: 4 * 60 * 60,
    startedAt: new Date(Date.UTC(2026, 7, 20 + i, 12, 0, 0, 0)).toISOString(),
  });
}

const rooms = plans.map((plan) => {
  const room = recordRoom(plan);
  const actions = room.actions.map((action) =>
    action.type === "START_DRAFT" ? { ...action, pool: "$board", excludedFromAutopick: action.pool.filter((e) => e.excludedFromAutopick === true).map((e) => e.playerId) } : action,
  );
  const { pool: _pool, ...finalState } = JSON.parse(JSON.stringify(room.state)) as Record<string, unknown>;
  return { name: plan.name, seed: plan.seed, humans: plan.humans, config: room.config, actions, finalState };
});

const out = join(TESTDATA, "mocks");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "logs.json"), `${JSON.stringify({ source: "scripts/export-mock-logs.ts", board: plainPool, rooms })}\n`);
console.log(`wrote ${rooms.length} rooms, ${rooms.reduce((n, r) => n + r.actions.length, 0)} actions`);
