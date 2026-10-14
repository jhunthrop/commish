// THE ORACLE'S WEEKLY MODEL, CALLED AS IT RUNS: the TypeScript side of the weekly parity cases.
//
//   DATABASE_URL=<dev copy> npx tsx research/parity/ts/weekly.ts project <season> <week> <asOfIso>
//   npx tsx research/parity/ts/weekly.ts layers <input.json>
//   npx tsx research/parity/ts/weekly.ts fit <input.json>
//   DATABASE_URL=<dev copy> npx tsx research/parity/ts/weekly.ts fit-reads <season>...
//
// `project` is the oracle's own `replay` with its own `modelSource()` (the committed `FITTED_MODEL`
// and `SHIPPED_FEATURES`): every read, the as-of gate and the composition are the oracle's. A
// pass-through source keeps the stat lines the model returned, which `replay` would otherwise only
// score; the score is discarded unread. It prints one JSON line of every predicted line.
//
// `layers` is the oracle's `modelProjection` on one week's input as the port read it (written to a
// JSON file), so the layers are compared on identical inputs where the oracle's own schema no
// longer holds the history (the dev copy's `public` schema lacks most of 2023).
//
// `fit` runs the oracle's four shipped fits (`fitOpportunityPriors`, `fitEfficiencyPriors`,
// `fitSchemePriors`, `fitGameContextPriors`) on the inputs the port read and wrote to a JSON file,
// so the comparison is of the fit's arithmetic on identical inputs. It prints the fitted priors.
//
// `fit-reads` is the oracle fit script's own reads (`projection-fit.ts`'s `usageForSeasons`,
// `historyForSeasons`, `contextForSeasons`: every season read at the far future, no as-of gate),
// printed whole so the port's `read_fit_data` can be compared against them row for row.
import { readFileSync } from "node:fs";
import { createDb } from "@research-ts/db/client";
import type { Position, StatLine } from "@research-ts/domain/player";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { replay, type ProjectionInput, type ProjectionSource } from "@research-ts/projections/backtest";
import { statLinesAsOf, type SeasonStatLine } from "@research-ts/projections/lines";
import { fitGameContextPriors } from "@research-ts/projections/model/context-fit";
import { fitEfficiencyPriors, fitOpportunityPriors } from "@research-ts/projections/model/fit";
import { fitSchemePriors } from "@research-ts/projections/model/scheme-fit";
import { modelProjection, modelSource } from "@research-ts/projections/model/source";
import type { TeamContext } from "@research-ts/projections/team-context";
import { LAST_POSSIBLE_WEEK } from "@research-ts/projections/store";
import { playerTeamsAsOf, teamObservationsAsOf, type PlayerWeekTeam, type TeamWeekObservation } from "@research-ts/projections/team-store";
import { usageAsOf, type PlayerWeekUsage } from "@research-ts/projections/usage";

const emit = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

async function project(season: number, week: number, asOfIso: string): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error("project needs DATABASE_URL");
  const db = createDb(url, { max: 2 });
  const model = modelSource();
  const lines: StatLine[] = [];
  const capturing: ProjectionSource = {
    name: model.name,
    project: async (input) => {
      const projected = await model.project(input);
      lines.push(...projected);
      return projected;
    },
  };
  try {
    await replay(db, { season, weeks: [week], source: capturing, rules: PPR_SCORING, asOfForWeek: () => new Date(asOfIso) });
  } finally {
    await db.$client.end();
  }
  emit({ lines });
}

const FINAL = new Date("9999-12-31T00:00:00.000Z");

async function fitReads(seasons: readonly number[]): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error("fit-reads needs DATABASE_URL");
  const db = createDb(url, { max: 2 });
  const usage: PlayerWeekUsage[] = [];
  const history: SeasonStatLine[] = [];
  const playerTeams: PlayerWeekTeam[] = [];
  const teamObservations: TeamWeekObservation[] = [];
  try {
    for (const season of seasons) {
      const span = { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL } as const;
      usage.push(...(await usageAsOf(db, span)));
      history.push(...(await statLinesAsOf(db, span)));
      playerTeams.push(...(await playerTeamsAsOf(db, span)));
      teamObservations.push(...(await teamObservationsAsOf(db, span)));
    }
  } finally {
    await db.$client.end();
  }
  emit({ usage, history, playerTeams, teamObservations });
}

interface InputFile {
  readonly positions: [string, Position][];
  readonly usage: (Omit<PlayerWeekUsage, "asOf"> & { asOf: string })[];
  readonly history: { season: number; line: StatLine; asOf: string }[];
  readonly playerTeams: (Omit<PlayerWeekTeam, "asOf"> & { asOf: string })[];
  readonly teamObservations: (Omit<TeamWeekObservation, "asOf"> & { asOf: string })[];
}

interface FitFile extends InputFile {
  readonly seasons: number[];
  readonly heldOut: number[];
}

interface LayersFile extends InputFile {
  readonly season: number;
  readonly week: number;
  readonly asOf: string;
  readonly firstRosterSeason: [string, number][];
}

function parsed(file: InputFile): { usage: PlayerWeekUsage[]; history: SeasonStatLine[]; positions: Map<string, Position>; context: TeamContext } {
  return {
    usage: file.usage.map((row) => ({ ...row, asOf: new Date(row.asOf) })) as unknown as PlayerWeekUsage[],
    history: file.history.map((row) => ({ ...row, asOf: new Date(row.asOf) })),
    positions: new Map(file.positions),
    context: {
      playerTeams: file.playerTeams.map((row) => ({ ...row, asOf: new Date(row.asOf) })),
      teamObservations: file.teamObservations.map((row) => ({ ...row, asOf: new Date(row.asOf) })),
    },
  };
}

function layers(path: string): void {
  const file = JSON.parse(readFileSync(path, "utf8")) as LayersFile;
  const { usage, history, positions, context } = parsed(file);
  const input: ProjectionInput = {
    season: file.season,
    week: file.week,
    asOf: new Date(file.asOf),
    history,
    usage,
    positions,
    teamContext: context,
    news: [],
    firstRosterSeason: new Map(file.firstRosterSeason),
  };
  emit({ lines: modelProjection(input) });
}

function fit(path: string): void {
  const file = JSON.parse(readFileSync(path, "utf8")) as FitFile;
  const { usage, history, positions, context } = parsed(file);
  const base = { usage, positions, seasons: file.seasons, heldOut: file.heldOut };
  const opportunity = fitOpportunityPriors(base);
  const efficiency = fitEfficiencyPriors({ ...base, history });
  const scheme = fitSchemePriors({ ...base, context, opportunity: opportunity.priors });
  const gameContext = fitGameContextPriors({ usage, history, context, seasons: file.seasons, heldOut: file.heldOut });
  emit({ opportunity: opportunity.priors, rmse: opportunity.fitted.rootMeanSquaredError, efficiency, scheme, gameContext });
}

async function main(): Promise<void> {
  const [command, first, second, third] = process.argv.slice(2);
  if (command === "project" && first !== undefined && second !== undefined && third !== undefined) {
    await project(Number(first), Number(second), third);
  } else if (command === "layers" && first !== undefined) {
    layers(first);
  } else if (command === "fit-reads" && first !== undefined) {
    await fitReads(process.argv.slice(3).map(Number));
  } else if (command === "fit" && first !== undefined) {
    fit(first);
  } else {
    throw new Error("usage: weekly.ts project <season> <week> <asOfIso> | layers <input.json> | fit <input.json> | fit-reads <season>...");
  }
}

await main();
