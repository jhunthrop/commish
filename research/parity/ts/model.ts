// THE ORACLE, CALLED AS IT RUNS: the TypeScript side of the model parity cases.
//
//   DATABASE_URL=<legacy scratch> npx tsx research/parity/ts/model.ts persist <season> <nowIso>
//   DATABASE_URL=<legacy scratch> npx tsx research/parity/ts/model.ts freeze|grade <season> <week> <nowIso>
//   DATABASE_URL=<legacy scratch> npx tsx research/parity/ts/model.ts held-out | fit-game-variance
//
// `persist` is the oracle's own `persistSeason`, the one board builder its operator script and its
// nightly fit step call, writing into the scratch copy it is pointed at; nothing about the board is
// restated here. Its operator lines are printed as `{"log": ...}` JSON lines (the moment, and each
// leg it wrote, are read from them), and the harness reads the written rows back from the scratch.
// A refusal (a degenerate live market) exits non-zero after the legs already written.
import { createDb, type Db } from "@research-ts/db/client";
import type { Clock } from "@research-ts/domain/timing";
import { heldOutScores } from "@research-ts/nightly/reads/held-out";
import { fitGameVariance, loadGameVarianceObservations } from "@research-ts/projections/preseason/game-variance";
import { persistSeason } from "@research-ts/projections/preseason/persist";
import { takeFreeze } from "@research-ts/projections/register/freeze";
import { gradeWeek } from "@research-ts/projections/register/grade";

const at = (iso: string): Clock => ({ now: () => Date.parse(iso) }) as Clock;
const emit = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

async function persist(db: Db, season: number, nowIso: string): Promise<void> {
  const take = await persistSeason(db, season, at(nowIso), new Map(), { log: (line) => emit({ log: line }) });
  emit({ momentKind: take.momentKind, written: take.written.map((leg) => leg.source) });
}

async function freeze(db: Db, season: number, week: number, nowIso: string): Promise<void> {
  const result = await takeFreeze(db, { season, week }, at(nowIso));
  emit({ frozenAt: result.frozenAt.toISOString(), rows: result.rows });
}

async function grade(db: Db, season: number, week: number, nowIso: string): Promise<void> {
  const result = await gradeWeek(db, { season, week }, at(nowIso));
  const boards = result.boards.map((board) => ({ boardSource: board.boardSource, population: board.population, scores: board.scores }));
  emit({ gradedAt: result.gradedAt.toISOString(), rows: result.rows, boards, skipped: result.skipped, population: result.population });
}

async function main(): Promise<void> {
  const [command, season, second, third] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (command === undefined || url === undefined) {
    throw new Error("usage: DATABASE_URL=... tsx model.ts persist <season> <nowIso> | freeze|grade <season> <week> <nowIso> | held-out | fit-game-variance");
  }
  const db = createDb(url, { max: 2 });
  try {
    if (command === "persist") await persist(db, Number(season), second!);
    else if (command === "freeze") await freeze(db, Number(season), Number(second), third!);
    else if (command === "grade") await grade(db, Number(season), Number(second), third!);
    else if (command === "held-out") emit(await heldOutScores(db));
    else if (command === "fit-game-variance") {
      const observations = await loadGameVarianceObservations(db, [2023, 2024]);
      emit(fitGameVariance(observations, { heldOutSeasons: [2025, 2026] }));
    } else throw new Error(`no command ${command}`);
  } finally {
    await db.$client.end();
  }
}

await main();
