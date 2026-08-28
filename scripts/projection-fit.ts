// Fits the projection model's parameters on the FIT seasons and writes them to
// src/projections/model/fitted.ts. Run: npm run projections:fit
// (dotenv -e .env.local -- tsx scripts/projection-fit.ts)
//
// The generated file is committed. That is the point: a model whose parameters are recomputed at
// runtime is a model nobody can reproduce a scoreboard from, and "what did the engine believe when
// it made that projection" has to be answerable from the repository alone. Regenerate it when the
// fit seasons change, never by hand.
//
// THE HELD-OUT DISCIPLINE LIVES HERE. `FIT_SEASONS` is the only list this script passes to the
// fitter, and `HELD_OUT_SEASONS` is asserted to be disjoint from it before anything runs. Tuning a
// parameter until the 2024 scoreboard looks good is the single most expensive mistake available in
// this work, because it produces a number nobody can trust and that cannot be detected from the
// inside — so the fence is code rather than intention.
import { writeFileSync } from "node:fs";
import { createDb, type Db } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { Position } from "@/domain/player";
import { statLinesAsOf, type SeasonStatLine } from "@/projections/lines";
import { RATES, TOUCHDOWN_RATES, type EfficiencyPriors, type RateName } from "@/projections/model/efficiency";
import { fitEfficiencyPriors, fitOpportunityPriors } from "@/projections/model/fit";
import { fitLinePriors, type LinePriors } from "@/projections/model/line-fit";
import { fitSchemePriors, type SchemePriors } from "@/projections/model/scheme-fit";
import { fitRedistributionPriors, type RedistributionPriors } from "@/projections/model/redistribution-fit";
import { fitGameContextPriors, type GameContextPriors } from "@/projections/model/context-fit";
import { fitRedZonePriors, type RedZoneFitReport } from "@/projections/model/red-zone-fit";
import { fitTargetDepthPriors, type TargetDepthFitReport } from "@/projections/model/target-depth-fit";
import { projectedPosition } from "@/projections/nflverse/players";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import { playerTeamsAsOf, teamObservationsAsOf } from "@/projections/team-store";
import type { TeamContext } from "@/projections/team-context";
import { usageAsOf, type PlayerWeekUsage } from "@/projections/usage";

/**
 * 2020 is history only — it has no prior season of its own (nflverse does not publish
 * `stats_player_week_2019.csv`), so a week-1 prediction inside it would fall back to the role prior
 * and teach the season-shrinkage parameter nothing.
 */
const HISTORY_SEASONS = [2020] as const;
const FIT_SEASONS = [2021, 2022] as const;
/** Never seen by any fit. Both of them, so a result can be checked on two independent seasons. */
const HELD_OUT_SEASONS = [2023, 2024] as const;

/**
 * Fitting reads FINAL, corrected numbers deliberately — the same choice `backtest.ts` makes for
 * actuals, and for the same reason. A parameter should be fitted against what really happened, not
 * against what was briefly believed on a Sunday night. The point-in-time gate governs what a model
 * may see when PREDICTING, which is a different question and is enforced at replay.
 */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

const OUTPUT = "src/projections/model/fitted.ts";

/** Mirrors `MAX_REGRESSION` in `fit.ts`; a constant at it means "no measurable spread", not "a lot". */
const MAX_REGRESSION_REPORTED = 10_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:fit\`, which loads .env.local.`);
  }
  return value;
}

async function positionsOf(db: Db): Promise<ReadonlyMap<string, Position>> {
  const rows = await db.select({ id: nflPlayers.id, position: nflPlayers.position }).from(nflPlayers);
  return new Map(
    rows
      .map((row) => [row.id, projectedPosition(row.position)] as const)
      .filter((entry): entry is readonly [string, Position] => entry[1] !== null),
  );
}

async function historyForSeasons(db: Db, seasons: readonly number[]): Promise<readonly SeasonStatLine[]> {
  const rows: SeasonStatLine[] = [];
  for (const season of seasons) {
    rows.push(...(await statLinesAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL })));
  }
  return rows;
}

async function usageForSeasons(db: Db, seasons: readonly number[]): Promise<readonly PlayerWeekUsage[]> {
  const rows: PlayerWeekUsage[] = [];
  for (const season of seasons) {
    rows.push(...(await usageAsOf(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL })));
  }
  return rows;
}

/**
 * The team-level context for the fit seasons, read WITHOUT an as-of gate.
 *
 * The same choice `historyForSeasons` makes and for the same reason: a parameter should be fitted
 * against what really happened, not against what was briefly believed on a Sunday night. The
 * point-in-time gate governs what a model may see when PREDICTING, and that is enforced at replay.
 * The composite the fit regresses against is still computed from weeks BEFORE the one it explains,
 * because a composite that included the week being predicted would measure a correlation the model
 * can never exploit.
 */
async function contextForSeasons(db: Db, seasons: readonly number[]): Promise<TeamContext> {
  const playerTeams = [];
  const teamObservations = [];
  for (const season of seasons) {
    const span = { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL } as const;
    playerTeams.push(...(await playerTeamsAsOf(db, span)));
    teamObservations.push(...(await teamObservationsAsOf(db, span)));
  }
  return { playerTeams, teamObservations };
}

function renderLine(line: LinePriors): string {
  return `/**
 * PHASE 3, TASK 1 — the offensive line composite's league means and its two measured elasticities.
 *
 * The elasticities are regression slopes, not guesses: log team rushing yards per carry against log
 * run-blocking composite, through the origin, weighted by carries, over the fit seasons' team-weeks
 * only. An elasticity near zero is the measurement saying the composite does not move the rate, and
 * the ablation is what decides whether the feature ships.
 */
export const FITTED_LINE_PRIORS: LinePriors = {
  league: {
    adjustedLineYards: ${line.league.adjustedLineYards.toFixed(6)},
    stuffedRate: ${line.league.stuffedRate.toFixed(6)},
    sackRateAllowed: ${line.league.sackRateAllowed.toFixed(6)},
  },
  rushingYardsElasticity: ${line.rushingYardsElasticity.toFixed(6)},
  passingYardsElasticity: ${line.passingYardsElasticity.toFixed(6)},
  leagueRushingYardsPerCarry: ${line.leagueRushingYardsPerCarry.toFixed(6)},
  leaguePassingYardsPerAttempt: ${line.leaguePassingYardsPerAttempt.toFixed(6)},
};
`;
}

function renderGameContext(gameContext: GameContextPriors): string {
  const pair = (name: string, elasticity: { opponent: number; rest: number }) =>
    `  ${name}: { opponent: ${elasticity.opponent.toFixed(6)}, rest: ${elasticity.rest.toFixed(6)} },`;
  return `/**
 * PHASE 3, TASK 4 — the opponent adjusted for the offences it has faced, and rest.
 *
 * Fitted directly against the league-relative team rate rather than against a residual, unlike the
 * scheme: layer 2 has never been shown who anybody played, so there is nothing here to double-count.
 * The implied total, the spread and the weather are absent on purpose and not by oversight — every
 * one of them is knowable only at kickoff, and the store's stamps make them unreachable from a
 * projection made the Tuesday before. See \`features/context.ts\`.
 */
export const FITTED_GAME_CONTEXT_PRIORS: GameContextPriors = {
${pair("passing", gameContext.passing)}
${pair("rushing", gameContext.rushing)}
  leaguePassingYardsPerAttempt: ${gameContext.leaguePassingYardsPerAttempt.toFixed(6)},
  leagueRushingYardsPerCarry: ${gameContext.leagueRushingYardsPerCarry.toFixed(6)},
};
`;
}

function renderRedistribution(redistribution: RedistributionPriors): string {
  return `/**
 * PHASE 3, TASK 3 — how much of a departed player's share the remaining roster actually takes on.
 *
 * Measured over ${redistribution.events} team-weeks with a detected departure on the fit seasons,
 * as a ratio of sums: the gap between what the roster really did and what layer 1 predicted, over
 * the share that vacated. Never 1 — an offence that loses its best receiver throws less, and that
 * part of the share stops existing rather than moving to anybody.
 */
export const FITTED_REDISTRIBUTION_PRIORS: RedistributionPriors = {
  absorptionRate: ${redistribution.absorptionRate.toFixed(6)},
  events: ${redistribution.events},
};
`;
}

function renderScheme(scheme: SchemePriors): string {
  const volume = (name: string, elasticity: { tempo: number; passLean: number }) =>
    `  ${name}: { tempo: ${elasticity.tempo.toFixed(6)}, passLean: ${elasticity.passLean.toFixed(6)} },`;
  return `/**
 * PHASE 3, TASK 2 — situation-neutral pace and pass rate, as elasticities on team volume.
 *
 * Fitted against the RESIDUAL of layer 1's own team-volume prediction, never against raw volume:
 * layer 1 already predicts volume from realised volume, which is mostly a function of pace, and
 * fitting there would count the same effect twice. Two regressors at once, because tempo and pass
 * lean are correlated and separate fits would each claim the other's effect.
 */
export const FITTED_SCHEME_PRIORS: SchemePriors = {
  league: {
    paceSecondsPerPlay: ${scheme.league.paceSecondsPerPlay.toFixed(6)},
    passRate: ${scheme.league.passRate.toFixed(6)},
    passRateOverExpected: ${scheme.league.passRateOverExpected.toFixed(6)},
  },
${volume("targets", scheme.targets)}
${volume("carries", scheme.carries)}
${volume("passAttempts", scheme.passAttempts)}
};
`;
}

function renderEfficiency(efficiency: EfficiencyPriors): string {
  const names = Object.keys(RATES) as RateName[];
  const row = (position: string) =>
    `    ${position}: {\n${names
      .map((name) => `      ${name}: ${efficiency.byPosition[position as Position][name].toFixed(6)},`)
      .join("\n")}\n    },`;
  return `export const FITTED_EFFICIENCY_PRIORS: EfficiencyPriors = {
  byPosition: {
${["QB", "RB", "WR", "TE", "K", "DEF"].map(row).join("\n")}
  },
  /**
   * How many OPPORTUNITIES of prior each rate is worth. Every touchdown rate is far above every
   * other, which is the measurement rather than the assumption — \`efficiency.test.ts\` pins it, so a
   * refit that produced a confident touchdown rate fails the suite instead of quietly shipping.
   */
  regression: {
${names.map((name) => `    ${name}: ${efficiency.regression[name].toFixed(2)},`).join("\n")}
  },
};
`;
}


function renderRedZone(report: RedZoneFitReport): string {
  const priors = report.priors;
  const rates = (position: string) => {
    const entry = priors.league[position as Position];
    return `    ${position}: { insideTenCarriesPerCarry: ${entry.insideTenCarriesPerCarry.toFixed(6)}, redZoneTargetsPerTarget: ${entry.redZoneTargetsPerTarget.toFixed(6)} },`;
  };
  return `/**
 * PHASE 5 — RED-ZONE LEVERAGE, the first group that separates a man from his own teammates.
 *
 * Fitted by maximum Poisson likelihood over ${report.rushingPlayerWeeks} player-weeks carrying
 * ${report.rushingTouchdowns} rushing touchdowns and ${report.receivingPlayerWeeks} carrying
 * ${report.receivingTouchdowns} receiving ones, on the fit seasons only. Least squares in log space
 * cannot be used here: a player's touchdowns in a week are zero far more often than not, and every
 * way of forcing that into a log destroys the thing being measured. The shrinkage constants are
 * fitted on the same likelihood rather than chosen, because "how many carries of prior is a
 * player's own red-zone rate worth" has an answer in the data and none in anybody's intuition.
 *
 * The leverage for a player-week is computed from the weeks BEFORE it, exactly as the model computes
 * it at prediction time — a goal-line carry and the touchdown it produced are in large part the same
 * play, so a leverage that saw its own week would fit an elasticity several times too large.
 */
export const FITTED_RED_ZONE_PRIORS: RedZonePriors = {
  league: {
${["QB", "RB", "WR", "TE", "K", "DEF"].map(rates).join("\n")}
  },
  recencyDecay: ${priors.recencyDecay},
  carryShrinkage: ${priors.carryShrinkage},
  targetShrinkage: ${priors.targetShrinkage},
  rushingElasticity: ${priors.rushingElasticity.toFixed(6)},
  receivingElasticity: ${priors.receivingElasticity.toFixed(6)},
};
`;
}

function renderTargetDepth(report: TargetDepthFitReport): string {
  const priors = report.priors;
  const depth = (position: string) => `    ${position}: ${priors.league[position as Position].toFixed(6)},`;
  return `/**
 * PHASE 5 — DEPTH OF TARGET, the second teammate-separating group.
 *
 * Fitted against the RESIDUAL of layer 2's own prediction over ${report.playerWeeks} player-weeks
 * carrying ${report.targets} targets, on the fit seasons only. Regressing yards per target on depth
 * of target would find a very strong relationship and measure almost nothing new, because layer 2
 * already predicts a receiver's yards per target from his own past yards per target — which is
 * itself mostly a consequence of how deep he is thrown to. The exposure handed to the estimator is
 * therefore what the model already thinks, and the elasticity is what depth adds to it.
 *
 * The two elasticities point in opposite directions or the feature is not describing football: a
 * deeper target is worth more yards and is caught less often.
 */
export const FITTED_TARGET_DEPTH_PRIORS: TargetDepthPriors = {
  league: {
${["QB", "RB", "WR", "TE", "K", "DEF"].map(depth).join("\n")}
  },
  recencyDecay: ${priors.recencyDecay},
  shrinkage: ${priors.shrinkage},
  yardsElasticity: ${priors.yardsElasticity.toFixed(6)},
  receptionsElasticity: ${priors.receptionsElasticity.toFixed(6)},
};
`;
}

function render(
  fit: ReturnType<typeof fitOpportunityPriors>,
  efficiency: EfficiencyPriors,
  line: LinePriors,
  scheme: SchemePriors,
  redistribution: RedistributionPriors,
  gameContext: GameContextPriors,
  redZone: RedZoneFitReport,
  targetDepth: TargetDepthFitReport,
  generatedFrom: readonly number[],
): string {
  const { priors } = fit;
  const role = (position: string) => {
    const entry = priors.byPosition[position as Position];
    return `    ${position}: { snapShare: ${entry.snapShare.toFixed(6)}, targetsPerSnap: ${entry.targetsPerSnap.toFixed(6)}, carriesPerSnap: ${entry.carriesPerSnap.toFixed(6)}, passAttemptsPerSnap: ${entry.passAttemptsPerSnap.toFixed(6)} },`;
  };
  return `import type { EfficiencyPriors } from "./efficiency";
import type { LinePriors } from "./line-fit";
import type { OpportunityPriors } from "./opportunity";
import type { GameContextPriors } from "./context-fit";
import type { RedistributionPriors } from "./redistribution-fit";
import type { RedZonePriors } from "../features/red-zone";
import type { TargetDepthPriors } from "../features/target-depth";
import type { SchemePriors } from "./scheme-fit";

/**
 * GENERATED by \`npm run projections:fit\`. Do not edit by hand — regenerate.
 *
 * Fitted on ${generatedFrom.join(" and ")} ONLY, with ${HISTORY_SEASONS.join(", ")} available as history.
 * ${HELD_OUT_SEASONS.join(" and ")} were never seen by the fit and are the seasons every reported
 * figure is measured on. Committing the numbers rather than recomputing them at runtime is what
 * makes a published scoreboard reproducible: "what did the engine believe when it said that" has to
 * be answerable from the repository alone.
 *
 * Next-week share error on the fit seasons, pooled over all four shares the model emits
 * (n = ${fit.fitted.sampleSize}). The baseline is last observed share with no shrinkage — layer 1's
 * own floor, the thing the model has to beat before anything above it is worth reviewing.
 *
 *            rho      MAE      RMSE
 *   fitted   ${(fit.fitted.rankCorrelation ?? 0).toFixed(4)}   ${(fit.fitted.meanAbsoluteError ?? 0).toFixed(5)}  ${(fit.fitted.rootMeanSquaredError ?? 0).toFixed(5)}
 *   baseline ${(fit.baseline.rankCorrelation ?? 0).toFixed(4)}   ${(fit.baseline.meanAbsoluteError ?? 0).toFixed(5)}  ${(fit.baseline.rootMeanSquaredError ?? 0).toFixed(5)}
 */
export const FIT_SEASONS: readonly number[] = [${generatedFrom.join(", ")}];
export const HELD_OUT_SEASONS: readonly number[] = [${HELD_OUT_SEASONS.join(", ")}];

export const FITTED_OPPORTUNITY_PRIORS: OpportunityPriors = {
  recencyDecay: ${priors.recencyDecay},
  byPosition: {
${["QB", "RB", "WR", "TE", "K", "DEF"].map(role).join("\n")}
  },
  shrinkage: { season: ${priors.shrinkage.season}, inSeason: ${priors.shrinkage.inSeason}, teamVolume: ${priors.shrinkage.teamVolume} },
  leagueTeamVolume: { targets: ${priors.leagueTeamVolume.targets.toFixed(4)}, carries: ${priors.leagueTeamVolume.carries.toFixed(4)}, passAttempts: ${priors.leagueTeamVolume.passAttempts.toFixed(4)} },
};

${renderEfficiency(efficiency)}
${renderLine(line)}
${renderScheme(scheme)}
${renderRedistribution(redistribution)}
${renderGameContext(gameContext)}
${renderRedZone(redZone)}
${renderTargetDepth(targetDepth)}`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const positions = await positionsOf(db);
  const usage = await usageForSeasons(db, [...HISTORY_SEASONS, ...FIT_SEASONS]);
  const history = await historyForSeasons(db, [...HISTORY_SEASONS, ...FIT_SEASONS]);
  console.log(`${usage.length} player-weeks of usage across ${[...HISTORY_SEASONS, ...FIT_SEASONS].join(", ")}, ${positions.size} players with a projectable position`);

  const started = Date.now();
  const fit = fitOpportunityPriors({ usage, positions, seasons: [...FIT_SEASONS], heldOut: [...HELD_OUT_SEASONS] });
  console.log(`fitted in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`  decay ${fit.priors.recencyDecay}, shrinkage season ${fit.priors.shrinkage.season} / in-season ${fit.priors.shrinkage.inSeason}`);
  const line = (name: string, score: typeof fit.fitted) =>
    `  ${name.padEnd(9)} rho ${(score.rankCorrelation ?? 0).toFixed(4)}   MAE ${(score.meanAbsoluteError ?? 0).toFixed(5)}   RMSE ${(score.rootMeanSquaredError ?? 0).toFixed(5)}   n=${score.sampleSize}`;
  console.log(line("fitted", fit.fitted));
  console.log(line("baseline", fit.baseline));
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    const role = fit.priors.byPosition[position];
    console.log(
      `  ${position}: snap ${role.snapShare.toFixed(3)}, targets/snap ${role.targetsPerSnap.toFixed(3)}, carries/snap ${role.carriesPerSnap.toFixed(3)}, attempts/snap ${role.passAttemptsPerSnap.toFixed(3)}`,
    );
  }

  const efficiency = fitEfficiencyPriors({ usage, history, positions, seasons: [...FIT_SEASONS], heldOut: [...HELD_OUT_SEASONS] });
  console.log("\nregression constants, in opportunities of prior (higher = regressed harder):");
  for (const name of Object.keys(RATES) as RateName[]) {
    const touchdown = (TOUCHDOWN_RATES as readonly string[]).includes(name);
    // A rate at the ceiling is not "very regressed", it is "the measurement found NO persistent
    // difference between players above sampling noise". Printing the two the same way would hide a
    // real result behind a large number.
    const ceiling = efficiency.regression[name] >= MAX_REGRESSION_REPORTED;
    console.log(
      `  ${name.padEnd(30)} ${efficiency.regression[name].toFixed(1).padStart(9)}${touchdown ? "   <- touchdown rate" : ""}${ceiling ? "   (no measurable spread between players, regressed entirely to role)" : ""}`,
    );
  }

  const context = await contextForSeasons(db, [...HISTORY_SEASONS, ...FIT_SEASONS]);
  const linePriors = fitLinePriors({ usage, history, context, seasons: [...FIT_SEASONS], heldOut: [...HELD_OUT_SEASONS] });
  console.log(
    `\noffensive line composite, fitted on ${FIT_SEASONS.join(", ")}:\n` +
      `  league adjusted line yards ${linePriors.league.adjustedLineYards.toFixed(3)}, stuffed rate ${linePriors.league.stuffedRate.toFixed(3)}, sack rate ${linePriors.league.sackRateAllowed.toFixed(3)}\n` +
      `  rushing yards elasticity ${linePriors.rushingYardsElasticity.toFixed(4)}, passing yards elasticity ${linePriors.passingYardsElasticity.toFixed(4)}`,
  );

  const schemePriors = fitSchemePriors({
    usage,
    positions,
    context,
    opportunity: fit.priors,
    seasons: [...FIT_SEASONS],
    heldOut: [...HELD_OUT_SEASONS],
  });
  console.log(
    `\nscheme, fitted on ${FIT_SEASONS.join(", ")} against layer 1's own residual:\n` +
      `  league pace ${schemePriors.league.paceSecondsPerPlay.toFixed(2)}s/play, neutral pass rate ${(schemePriors.league.passRate * 100).toFixed(1)}%, PROE ${schemePriors.league.passRateOverExpected.toFixed(2)}\n` +
      `  targets      tempo ${schemePriors.targets.tempo.toFixed(4)}  passLean ${schemePriors.targets.passLean.toFixed(4)}\n` +
      `  carries      tempo ${schemePriors.carries.tempo.toFixed(4)}  passLean ${schemePriors.carries.passLean.toFixed(4)}\n` +
      `  passAttempts tempo ${schemePriors.passAttempts.tempo.toFixed(4)}  passLean ${schemePriors.passAttempts.passLean.toFixed(4)}`,
  );

  const redistributionPriors = fitRedistributionPriors({
    usage,
    positions,
    context,
    opportunity: fit.priors,
    seasons: [...FIT_SEASONS],
    heldOut: [...HELD_OUT_SEASONS],
  });
  console.log(
    `\nredistribution, fitted on ${FIT_SEASONS.join(", ")}:\n` +
      `  absorption rate ${redistributionPriors.absorptionRate.toFixed(4)} over ${redistributionPriors.events} team-weeks with a detected departure`,
  );

  const gameContextPriors = fitGameContextPriors({
    usage,
    history,
    context,
    seasons: [...FIT_SEASONS],
    heldOut: [...HELD_OUT_SEASONS],
  });
  console.log(
    `\ngame context, fitted on ${FIT_SEASONS.join(", ")}:\n` +
      `  passing  opponent ${gameContextPriors.passing.opponent.toFixed(4)}  rest ${gameContextPriors.passing.rest.toFixed(4)}\n` +
      `  rushing  opponent ${gameContextPriors.rushing.opponent.toFixed(4)}  rest ${gameContextPriors.rushing.rest.toFixed(4)}`,
  );

  const redZone = fitRedZonePriors({
    usage,
    history,
    positions,
    efficiency,
    seasons: [...FIT_SEASONS],
    heldOut: [...HELD_OUT_SEASONS],
  });
  console.log(
    `\nred-zone leverage, fitted on ${FIT_SEASONS.join(", ")} by Poisson likelihood:\n` +
      `  decay ${redZone.priors.recencyDecay} per week, chosen on both sides' likelihoods together\n` +
      `  rushing    elasticity ${redZone.priors.rushingElasticity.toFixed(4)}  over ${redZone.rushingPlayerWeeks} player-weeks and ${redZone.rushingTouchdowns} touchdowns, ${redZone.priors.carryShrinkage} carries of prior\n` +
      `  receiving  elasticity ${redZone.priors.receivingElasticity.toFixed(4)}  over ${redZone.receivingPlayerWeeks} player-weeks and ${redZone.receivingTouchdowns} touchdowns, ${redZone.priors.targetShrinkage} targets of prior`,
  );

  const targetDepth = fitTargetDepthPriors({
    usage,
    history,
    positions,
    efficiency,
    seasons: [...FIT_SEASONS],
    heldOut: [...HELD_OUT_SEASONS],
  });
  console.log(
    `\ntarget depth, fitted on ${FIT_SEASONS.join(", ")} against layer 2's own residual:\n` +
      `  decay ${targetDepth.priors.recencyDecay} per week, ${targetDepth.priors.shrinkage} targets of prior, over ${targetDepth.playerWeeks} player-weeks and ${targetDepth.targets} targets\n` +
      `  yards      elasticity ${targetDepth.priors.yardsElasticity.toFixed(4)}\n` +
      `  receptions elasticity ${targetDepth.priors.receptionsElasticity.toFixed(4)}`,
  );

  writeFileSync(
    OUTPUT,
    render(fit, efficiency, linePriors, schemePriors, redistributionPriors, gameContextPriors, redZone, targetDepth, FIT_SEASONS),
  );
  console.log(`\nwrote ${OUTPUT}`);

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
