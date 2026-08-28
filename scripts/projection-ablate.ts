// Ablates one feature group at a time on the held-out seasons and prints `rho before -> rho after`.
// Run: npm run projections:ablate [feature] [season...]
// (dotenv -e .env.local -- tsx scripts/projection-ablate.ts line 2024 2023)
//
// THIS IS THE INSTRUMENT PHASE 3 IS GOVERNED BY. Every feature group lands with its own measured
// ablation in its own commit, because a bundle of five features that improves the model teaches us
// nothing about which of the five mattered, and next year somebody has to maintain all five.
//
// It reads the store and NOTHING ELSE. `projection-report.ts` re-ingests two seasons over the
// network before it prints anything, which is right for a headline scoreboard run once, and wrong
// for a measurement run twenty times in an afternoon: an ablation that costs a hundred megabytes is
// an ablation that gets skipped. The replay moments come from `replayMomentsFor`, which reads back
// the very stamps the ingestion wrote, so a number printed here and a number printed there are
// comparable by construction.
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { replayHeadToHead, replayOpportunity, SHARE_FIELDS, type ProjectionSource } from "@/projections/backtest";
import { naiveProjection, NAIVE_SOURCE_NAME } from "@/projections/benchmarks/naive";
import { ALL_FEATURES, NO_FEATURES, type FeatureFlags } from "@/projections/model/features";
import { scoreShares } from "@/projections/model/fit";
import { FITTED_OPPORTUNITY_PRIORS, FIT_SEASONS, HELD_OUT_SEASONS } from "@/projections/model/fitted";
import { lastObservedPriors } from "@/projections/model/opportunity";
import { modelSource } from "@/projections/model/source";
import { detectTransactions } from "@/projections/model/transactions";
import { predictOpportunity } from "@/projections/model/opportunity";
import type { ProjectionInput } from "@/projections/backtest";
import { RANK_BANDS, type ScoreCard } from "@/projections/metrics";
import { replayMomentsFor } from "@/projections/replay-moments";

const LAST_REGULAR_WEEK = 18;

/**
 * The variants an ablation run compares, keyed by the argument an operator types.
 *
 * Every entry is a PAIR — the model without the group and the model with it — rather than a
 * cumulative stack, because the question a feature has to answer is "what did YOU add", and a
 * cumulative run answers "what did you and everything before you add together". `all` is the one
 * exception and is labelled as such: it is the headline, not an ablation.
 */
const VARIANTS: Readonly<Record<string, { readonly before: FeatureFlags; readonly after: FeatureFlags; readonly label: string }>> = {
  line: { before: NO_FEATURES, after: { ...NO_FEATURES, line: true }, label: "offensive line composite" },
  scheme: { before: NO_FEATURES, after: { ...NO_FEATURES, scheme: true }, label: "scheme, pace and the coaching-change prior" },
  redistribution: {
    before: NO_FEATURES,
    after: { ...NO_FEATURES, redistribution: true },
    label: "opportunity redistribution",
  },
  context: { before: NO_FEATURES, after: { ...NO_FEATURES, gameContext: true }, label: "game context" },
  all: { before: NO_FEATURES, after: ALL_FEATURES, label: "every feature group at once (headline, not an ablation)" },
};

/**
 * THE POST-TRANSACTION SEGMENT — the player-weeks the redistribution feature can possibly affect.
 *
 * The founder's instruction for Task 3 was to measure this rather than the average, and the reason
 * is arithmetic: a feature that fires on two per cent of player-weeks cannot move a pooled figure
 * over four thousand of them however right it is, and judging it on the average would discard it
 * for a rounding error. A feature that fixes exactly what it was built for and is neutral elsewhere
 * is a success.
 *
 * The set is computed from the SAME `ProjectionInput` both arms were handed, through the same
 * detector the feature itself uses. Selecting on anything else — on the actual outcome, on a
 * hand-listed set of trades — would be selecting on something other than the situation it names.
 */
function postTransactionSegment(input: ProjectionInput): ReadonlySet<string> {
  const opportunity = predictOpportunity(
    input.usage,
    { season: input.season, week: input.week, positions: input.positions },
    FITTED_OPPORTUNITY_PRIORS,
  );
  const transactions = detectTransactions({
    usage: input.usage,
    playerTeams: input.teamContext.playerTeams,
    positions: input.positions,
    snapShares: new Map([...opportunity].map(([playerId, player]) => [playerId, player.snapShare] as const)),
  });
  const affected = new Set<string>();
  for (const transaction of transactions) {
    if (transaction.departures.length === 0 && transaction.arrivals.length === 0) continue;
    for (const player of transaction.roster) affected.add(player.playerId);
  }
  return affected;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:ablate\`, which loads .env.local.`);
  }
  return value;
}

function rho(score: ScoreCard): string {
  return score.rankCorrelation === null ? " n/a " : score.rankCorrelation.toFixed(4);
}

function delta(before: ScoreCard, after: ScoreCard): string {
  if (before.rankCorrelation === null || after.rankCorrelation === null) return "  n/a ";
  const difference = after.rankCorrelation - before.rankCorrelation;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(4)}`;
}

function errors(score: ScoreCard): string {
  const mae = score.meanAbsoluteError === null ? " n/a " : score.meanAbsoluteError.toFixed(3);
  const rmse = score.rootMeanSquaredError === null ? " n/a " : score.rootMeanSquaredError.toFixed(3);
  return `MAE ${mae.padStart(6)}  RMSE ${rmse.padStart(6)}  n=${score.sampleSize}`;
}

/**
 * LAYER 1 ON ITS OWN TERMS, without the network the report script needs.
 *
 * Printed as its own variant because the shares are what a change to the FIT is measured on, and a
 * points scoreboard cannot see the difference: an efficiency error and an opportunity error look
 * identical there. Model v1 left pass-attempt share out of the fit's objective and it was the one
 * share that regressed, which is a defect only this table shows.
 */
async function reportShares(db: ReturnType<typeof createDb>, seasons: readonly number[], weeks: readonly number[]): Promise<void> {
  console.log("LAYER 1, predicted share against observed share, on held-out seasons");
  console.log(`  parameters fitted on ${FIT_SEASONS.join(", ")}; held out: ${HELD_OUT_SEASONS.join(", ")}\n`);
  for (const season of seasons) {
    if ((FIT_SEASONS as readonly number[]).includes(season)) {
      console.log(`${season} is a FIT season; its share numbers would be a description, not a measurement. Skipped.\n`);
      continue;
    }
    const asOfForWeek = await replayMomentsFor(db, season);
    const model = await replayOpportunity(db, { season, weeks, asOfForWeek, priors: FITTED_OPPORTUNITY_PRIORS });
    const floorPriors = lastObservedPriors(FITTED_OPPORTUNITY_PRIORS);
    const floor = await replayOpportunity(db, { season, weeks, asOfForWeek, priors: floorPriors });
    console.log(`${season}`);
    const line = (name: string, observations: Parameters<typeof scoreShares>[0]): string => {
      const score = scoreShares(observations);
      return `  ${name.padEnd(22)} rho ${(score.rankCorrelation ?? 0).toFixed(4)}   MAE ${(score.meanAbsoluteError ?? 0).toFixed(5)}   RMSE ${(score.rootMeanSquaredError ?? 0).toFixed(5)}   n=${score.sampleSize}`;
    };
    for (const field of SHARE_FIELDS) {
      console.log(line(`${field} model`, model.byShare[field]));
      console.log(line(`${field} last-week`, floor.byShare[field]));
    }
    console.log(line("POOLED model", model.pooled));
    console.log(line("POOLED last-week", floor.pooled));
    console.log("");
  }
}

async function main(): Promise<void> {
  const feature = process.argv[2] ?? "all";
  if (feature === "shares") {
    const db = createDb(requireEnv("DATABASE_URL"));
    const seasons = process.argv.slice(3).map(Number);
    await reportShares(
      db,
      seasons.length > 0 ? seasons : [...HELD_OUT_SEASONS],
      Array.from({ length: LAST_REGULAR_WEEK }, (_, index) => index + 1),
    );
    await db.$client.end();
    return;
  }
  const variant = VARIANTS[feature];
  if (variant === undefined) {
    throw new Error(`Unknown feature group "${feature}". Known groups: ${Object.keys(VARIANTS).join(", ")}.`);
  }
  const seasons = process.argv.slice(3).map(Number);
  const targets = seasons.length > 0 ? seasons : [2024, 2023];
  // Only the redistribution feature has a situation narrow enough to need one, and it is the one
  // the founder named. Everything else is measured over everybody.
  const segment = feature === "redistribution" ? postTransactionSegment : undefined;
  if (targets.some((season) => !Number.isInteger(season))) {
    throw new Error(`Seasons must be whole numbers; got ${process.argv.slice(3).join(", ")}.`);
  }

  const db = createDb(requireEnv("DATABASE_URL"));
  const weeks = Array.from({ length: LAST_REGULAR_WEEK }, (_, index) => index + 1);

  console.log(`ABLATION: ${variant.label}`);
  console.log("  measured on seasons no fit has ever seen, like for like against the naive floor");
  console.log(segment === undefined ? "" : "  RESTRICTED TO THE POST-TRANSACTION SEGMENT\n");

  for (const season of targets) {
    const asOfForWeek = await replayMomentsFor(db, season);
    const naive: ProjectionSource = {
      name: NAIVE_SOURCE_NAME,
      project: ({ history, season: replaySeason, week }) => naiveProjection(history, { season: replaySeason, week }),
    };
    const before = modelSource(undefined, variant.before, "model-before");
    const after = modelSource(undefined, variant.after, "model-after");
    const headToHead = await replayHeadToHead(db, {
      season,
      weeks,
      sources: [naive, before, after],
      rules: PPR_SCORING,
      asOfForWeek,
      segment,
    });
    const [floorScore, beforeScore, afterScore] = headToHead.common;

    console.log(`${season}`);
    console.log(`  floor        rho ${rho(floorScore!.overall)}   ${errors(floorScore!.overall)}`);
    console.log(`  before       rho ${rho(beforeScore!.overall)}   ${errors(beforeScore!.overall)}`);
    console.log(`  after        rho ${rho(afterScore!.overall)}   ${errors(afterScore!.overall)}`);
    console.log(`  OVERALL      ${rho(beforeScore!.overall)} -> ${rho(afterScore!.overall)}   ${delta(beforeScore!.overall, afterScore!.overall)}`);
    console.log("  by rank band");
    for (const band of RANK_BANDS) {
      const bandBefore = beforeScore!.byRankBand[band.name];
      const bandAfter = afterScore!.byRankBand[band.name];
      console.log(
        `    ${band.name.padEnd(8)} ${rho(bandBefore)} -> ${rho(bandAfter)}   ${delta(bandBefore, bandAfter)}   n=${bandAfter.sampleSize}`,
      );
    }
    const half = (result: (typeof headToHead.common)[number], from: number, to: number): number => {
      const inRange = result.weeks.filter((week) => week.week >= from && week.week <= to);
      return inRange.reduce((sum, week) => sum + (week.overall.rankCorrelation ?? 0), 0) / inRange.length;
    };
    console.log(
      `  weeks 1-9    ${half(beforeScore!, 1, 9).toFixed(4)} -> ${half(afterScore!, 1, 9).toFixed(4)}\n` +
        `  weeks 10-18  ${half(beforeScore!, 10, 18).toFixed(4)} -> ${half(afterScore!, 10, 18).toFixed(4)}\n`,
    );
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
