// Measures whether the availability model's `reserve` multiplier should be split by resolved
// designation (current-status round, 2026-09-09): fits on the fit seasons through the same
// `fitAvailabilityPriors` the committed priors come from, once pooled (one multiplier per cutdown
// status, the committed shape) and once with a cell per designation (`designationCells`), then
// scores expected games against games played on the held-out seasons, whole population and the
// reserve-designated subgroup split by whether an ADP board listed him.
// Run: npm run projections:availability:split
//
// THE DECISION RULE IS PRINTED WITH THE NUMBERS AND NOT TAKEN HERE. The split ships only if the
// held-out population is not worse overall AND the reserve subgroup is better; the ledger records
// the call. Nothing here writes `fitted.ts`: `npm run projections:preseason:fit` does, and only
// after this script has said the split earned it.
//
// A MEASUREMENT RUN, SO THE DEV STORE ONLY: repeated reads against production are what the Neon
// data-transfer quota incident was made of (`prod-db-is-for-backfills-only`).
import { inArray } from "drizzle-orm";
import { createDb, type Db } from "@research/db/client";
import { nflPlayers } from "@research/db/schema";
import { marketBoard } from "@research/projections/market/curve";
import { FIT_SEASONS, HELD_OUT_SEASONS } from "@research/projections/model/fitted";
import { expectedGamesPlayed, type AvailabilityPriors } from "@research/projections/preseason/availability";
import { fitAvailabilityPriors, type AvailabilityObservation } from "@research/projections/preseason/availability-fit";
import { loadAvailabilityObservations } from "@research/projections/preseason/availability-history";
import { AVAILABILITY_DESIGNATIONS, type AvailabilityDesignation } from "@research/projections/preseason/availability-status";
import { FITTED_AVAILABILITY_PRIORS } from "@research/projections/preseason/fitted";
import { replayMomentFor } from "@research/projections/preseason/source";

const SKILL = new Set(["QB", "RB", "WR", "TE"]);

interface Scored {
  readonly observation: AvailabilityObservation;
  readonly listed: boolean;
  readonly expected: number;
  readonly floor: number;
  readonly ceiling: number;
}

interface Calibration {
  readonly n: number;
  readonly rmse: number;
  readonly bias: number;
  readonly mae: number;
  readonly coverage: number;
  readonly meanExpected: number;
  readonly meanPlayed: number;
}

function requireLocalDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") throw new Error("DATABASE_URL is not set. Run this through `npm run projections:availability:split`, which loads .env.local.");
  if (!url.includes("localhost") && !url.includes("127.0.0.1")) throw new Error("This is a measurement run and reads the dev store only; DATABASE_URL does not point at localhost.");
  return url;
}

function calibrationOf(rows: readonly Scored[]): Calibration | null {
  if (rows.length === 0) return null;
  const errors = rows.map((row) => row.expected - row.observation.gamesPlayed);
  const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
  return {
    n: rows.length,
    rmse: Math.sqrt(sum(errors.map((error) => error * error)) / rows.length),
    bias: sum(errors) / rows.length,
    mae: sum(errors.map((error) => Math.abs(error))) / rows.length,
    coverage: rows.filter((row) => row.observation.gamesPlayed >= row.floor && row.observation.gamesPlayed <= row.ceiling).length / rows.length,
    meanExpected: sum(rows.map((row) => row.expected)) / rows.length,
    meanPlayed: sum(rows.map((row) => row.observation.gamesPlayed)) / rows.length,
  };
}

function line(label: string, rows: readonly Scored[]): string {
  const c = calibrationOf(rows);
  if (c === null) return `  ${label.padEnd(36)} n=0`;
  return `  ${label.padEnd(36)} n=${String(c.n).padStart(5)}  RMSE ${c.rmse.toFixed(3)}  bias ${c.bias.toFixed(3).padStart(7)}  MAE ${c.mae.toFixed(3)}  p10-p90 ${c.coverage.toFixed(3)}  mean exp ${c.meanExpected.toFixed(2).padStart(5)} played ${c.meanPlayed.toFixed(2).padStart(5)}`;
}

function score(observations: readonly AvailabilityObservation[], listed: ReadonlyMap<number, ReadonlySet<string>>, priors: AvailabilityPriors): readonly Scored[] {
  return observations.map((observation) => {
    const outlook = expectedGamesPlayed(observation, { season: observation.season, priors });
    return { observation, listed: listed.get(observation.season)?.has(observation.playerId) ?? false, expected: outlook.expected, floor: outlook.distribution.floor, ceiling: outlook.distribution.ceiling };
  });
}

function report(label: string, scored: readonly Scored[]): void {
  console.log(`\n${label}`);
  console.log(line("all", scored));
  for (const status of ["active", "reserve", "practice_squad"] as const) console.log(line(`  ${status}`, scored.filter((row) => row.observation.status === status)));
  console.log(line("  reserve, ADP-listed", scored.filter((row) => row.observation.status === "reserve" && row.listed)));
  console.log(line("  reserve, unlisted", scored.filter((row) => row.observation.status === "reserve" && !row.listed)));
  for (const cell of AVAILABILITY_DESIGNATIONS) console.log(line(`  designation ${cell}`, scored.filter((row) => row.observation.designation === cell)));
}

function countCells(observations: readonly AvailabilityObservation[]): string {
  return AVAILABILITY_DESIGNATIONS.map((cell) => `${cell} ${observations.filter((observation) => observation.designation === cell).length}`).join(", ");
}

function describeCells(priors: AvailabilityPriors): string {
  const table = priors.designationMultiplier ?? {};
  return (Object.keys(table) as AvailabilityDesignation[]).map((cell) => `${cell} ${(table[cell] ?? NaN).toFixed(3)}`).join("  ");
}

async function listedBySeason(db: Db, seasons: readonly number[]): Promise<ReadonlyMap<number, ReadonlySet<string>>> {
  const out = new Map<number, ReadonlySet<string>>();
  for (const season of seasons) {
    const { entries } = await marketBoard(db, season, (await replayMomentFor(db, season)).at);
    out.set(season, new Set(entries.map((entry) => entry.playerId)));
  }
  return out;
}

async function namesFor(db: Db, ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers).where(inArray(nflPlayers.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.name] as const));
}

function decision(pooled: readonly Scored[], split: readonly Scored[]): string {
  const overall = [calibrationOf(pooled), calibrationOf(split)];
  const reserve = [calibrationOf(pooled.filter((row) => row.observation.status === "reserve")), calibrationOf(split.filter((row) => row.observation.status === "reserve"))];
  if (overall[0] === null || overall[1] === null || reserve[0] === null || reserve[1] === null) return "no population to decide on";
  const notWorseOverall = overall[1].rmse <= overall[0].rmse + 1e-9;
  const betterOnReserve = reserve[1].rmse < reserve[0].rmse && reserve[1].mae < reserve[0].mae;
  return `held-out overall RMSE pooled ${overall[0].rmse.toFixed(3)} split ${overall[1].rmse.toFixed(3)} (${notWorseOverall ? "not worse" : "WORSE"}); reserve subgroup RMSE ${reserve[0].rmse.toFixed(3)} -> ${reserve[1].rmse.toFixed(3)}, MAE ${reserve[0].mae.toFixed(3)} -> ${reserve[1].mae.toFixed(3)} (${betterOnReserve ? "better" : "NOT better"}) => the split ${notWorseOverall && betterOnReserve ? "MAY ship" : "does NOT ship"}`;
}

async function main(): Promise<void> {
  const db = createDb(requireLocalDatabaseUrl());
  const fit = (await loadAvailabilityObservations(db, FIT_SEASONS)).filter((observation) => SKILL.has(observation.position));
  const heldOut = (await loadAvailabilityObservations(db, HELD_OUT_SEASONS)).filter((observation) => SKILL.has(observation.position));
  const listed = await listedBySeason(db, HELD_OUT_SEASONS);
  console.log(`fit ${FIT_SEASONS.join("-")}: ${fit.length} skill player-seasons; designation cells: ${countCells(fit)}`);
  console.log(`held out ${HELD_OUT_SEASONS.join("-")}: ${heldOut.length} skill player-seasons; designation cells: ${countCells(heldOut)}`);

  const pooled = fitAvailabilityPriors(fit, { heldOutSeasons: HELD_OUT_SEASONS });
  const split = fitAvailabilityPriors(fit, { heldOutSeasons: HELD_OUT_SEASONS, designationCells: [...AVAILABILITY_DESIGNATIONS] });
  console.log(`\npooled re-fit: status multipliers ${Object.entries(pooled.statusMultiplier).map(([status, value]) => `${status} ${value.toFixed(4)}`).join("  ")}; grid ${pooled.priorGames}/${pooled.availabilityPriorGames}/${pooled.recencyDecay}`);
  console.log(`split re-fit:  status multipliers ${Object.entries(split.statusMultiplier).map(([status, value]) => `${status} ${value.toFixed(4)}`).join("  ")}; grid ${split.priorGames}/${split.availabilityPriorGames}/${split.recencyDecay}`);
  console.log(`split re-fit:  designation cells (shrunk toward the coarse status by 20 pseudo-seasons) ${describeCells(split)}`);

  const arms = [
    ["COMMITTED priors (the served numbers)", score(heldOut, listed, FITTED_AVAILABILITY_PRIORS)],
    ["POOLED re-fit on the resolution's status", score(heldOut, listed, pooled)],
    ["SPLIT re-fit, a cell per designation", score(heldOut, listed, split)],
  ] as const;
  for (const [label, scored] of arms) report(`HELD-OUT ${HELD_OUT_SEASONS.join("-")}: ${label}`, scored);

  const listedReserve = arms[0][1].filter((row) => row.observation.status === "reserve" && row.listed);
  const names = await namesFor(db, listedReserve.map((row) => row.observation.playerId));
  console.log("\nlisted reserve-designated rows (expected games: committed / pooled / split; played):");
  for (const row of listedReserve) {
    const id = row.observation.playerId;
    const pick = (scored: readonly Scored[]): number => scored.find((entry) => entry.observation.playerId === id && entry.observation.season === row.observation.season)?.expected ?? NaN;
    console.log(`  ${row.observation.season} ${(names.get(id) ?? id).padEnd(24)} ${row.observation.position} ${(row.observation.designation ?? "-").padEnd(24)} ${pick(arms[0][1]).toFixed(2)} / ${pick(arms[1][1]).toFixed(2)} / ${pick(arms[2][1]).toFixed(2)}; played ${row.observation.gamesPlayed}`);
  }

  console.log(`\nDECISION RULE: ${decision(arms[1][1], arms[2][1])}`);
  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
