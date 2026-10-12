// Prints the before/after starter-band scorecard, per position, for Task 5's two candidate fixes
// (WR/TE share-shrinkage recalibration, the years-4-6 experience term) on the VALIDATION fold.
// Run: npm run projections:calibrate
// (dotenv -e .env.local -- tsx scripts/calibration-report.ts)
//
// THE VALIDATION FOLD IS FIXED AT SEASON 2022 (predictor 2021, outcome 2022) AND NEVER 2023/2024.
// Those two seasons are the final bar's untouched seasons for this whole plan; a calibration decision
// that read them would be tuning against the number the plan's own close-out reports on. Season 2022
// answers the same question honestly: `replay`'s own history read pulls in 2021 as the prior season
// and the in-season weeks of 2022 as they accumulate, so scoring a 2022 replay against 2022 outcomes
// already is "trained on 2021, judged on 2022" by construction, with no separate season-to-season
// forecast to build.
//
// THE ACCEPTANCE RULE (task-5-brief.md, spec-binding): a fix lands only if this report shows the
// TARGET cohort improving without degrading the OTHERS on this fold. Every skill position is printed
// for every fix, not only the one it targets, so "without degrading the others" is a claim this
// report can actually back up rather than one taken on faith.
import { createDb } from "@research-ts/db/client";
import type { Position } from "@research-ts/domain/player";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { replayHeadToHead, type ProjectionInput, type ProjectionSource } from "@research-ts/projections/backtest";
import { RANK_BANDS, type ScoreCard } from "@research-ts/projections/metrics";
import { FITTED_MODEL, modelSource, type ModelPriors } from "@research-ts/projections/model/source";
import { SHIPPED_FEATURES } from "@research-ts/projections/model/features";
import { replayMomentsFor } from "@research-ts/projections/replay-moments";

const VALIDATION_SEASON = 2022;
const NEVER_SCORE_SEASONS = [2023, 2024] as const;
const LAST_REGULAR_WEEK = 18;
const SKILL_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];

if ((NEVER_SCORE_SEASONS as readonly number[]).includes(VALIDATION_SEASON)) {
  throw new Error("The validation fold must never be one of the final bar's untouched seasons.");
}

/**
 * FITTED_MODEL WITH TASK 5'S TWO CANDIDATE TERMS STRIPPED — the "before" arm.
 *
 * `fitted.ts` already carries the candidate `shareShrinkageByPosition` and `experienceMultiplier`
 * fields by the time this script runs (`npm run projections:fit` writes both unconditionally, and
 * this report is what decides whether they stay). Building "before" by deleting the two fields back
 * out, rather than keeping a second committed copy of the whole model, means there is exactly one
 * source of truth for every OTHER fitted number, and the only difference between the two arms is
 * the thing being tested.
 */
const BEFORE: ModelPriors = {
  ...FITTED_MODEL,
  opportunity: { ...FITTED_MODEL.opportunity, shareShrinkageByPosition: undefined },
  efficiency: { ...FITTED_MODEL.efficiency, experienceMultiplier: undefined },
};
const AFTER: ModelPriors = FITTED_MODEL;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:calibrate\`, which loads .env.local.`);
  }
  return value;
}

/** Every player of one position, read from the SAME `ProjectionInput` both arms were handed. */
function positionSegment(position: Position): (input: ProjectionInput) => ReadonlySet<string> {
  return (input) => new Set([...input.positions].filter(([, value]) => value === position).map(([playerId]) => playerId));
}

function rho(score: ScoreCard): string {
  return score.rankCorrelation === null ? " n/a " : score.rankCorrelation.toFixed(4);
}

function delta(before: ScoreCard, after: ScoreCard): string {
  if (before.rankCorrelation === null || after.rankCorrelation === null) return "  n/a ";
  const difference = after.rankCorrelation - before.rankCorrelation;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(4)}`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const weeks = Array.from({ length: LAST_REGULAR_WEEK }, (_, index) => index + 1);
  const asOfForWeek = await replayMomentsFor(db, VALIDATION_SEASON);

  console.log(`CALIBRATION REPORT, task 5 (starter-band recalibration and the experience-year prior)`);
  console.log(`  validation fold: predictor ${VALIDATION_SEASON - 1}, outcome ${VALIDATION_SEASON}. Never ${NEVER_SCORE_SEASONS.join(", ")}.`);
  console.log(`  before: shipped model, no Task 5 terms. after: shipped model plus the fitted.ts candidates.\n`);

  const results: Record<Position, { before: Awaited<ReturnType<typeof replayHeadToHead>>["common"][number]; after: Awaited<ReturnType<typeof replayHeadToHead>>["common"][number] }> = {} as never;

  for (const position of SKILL_POSITIONS) {
    const before: ProjectionSource = modelSource(BEFORE, SHIPPED_FEATURES, "before");
    const after: ProjectionSource = modelSource(AFTER, SHIPPED_FEATURES, "after");
    const headToHead = await replayHeadToHead(db, {
      season: VALIDATION_SEASON,
      weeks,
      sources: [before, after],
      rules: PPR_SCORING,
      asOfForWeek,
      segment: positionSegment(position),
    });
    const [beforeScore, afterScore] = headToHead.common;
    results[position] = { before: beforeScore!, after: afterScore! };

    console.log(`${position}`);
    console.log(`  overall      ${rho(beforeScore!.overall)} -> ${rho(afterScore!.overall)}   ${delta(beforeScore!.overall, afterScore!.overall)}   n=${afterScore!.overall.sampleSize}`);
    for (const band of RANK_BANDS) {
      const bandBefore = beforeScore!.byRankBand[band.name];
      const bandAfter = afterScore!.byRankBand[band.name];
      console.log(`  ${band.name.padEnd(8)}     ${rho(bandBefore)} -> ${rho(bandAfter)}   ${delta(bandBefore, bandAfter)}   n=${bandAfter.sampleSize}`);
    }
    console.log("");
  }

  console.log("SUMMARY (starter band, rank 51-150 within each position's own board)");
  console.log("  position  before    after     delta");
  for (const position of SKILL_POSITIONS) {
    const bandBefore = results[position]!.before.byRankBand.starter;
    const bandAfter = results[position]!.after.byRankBand.starter;
    console.log(`  ${position.padEnd(8)}  ${rho(bandBefore)}    ${rho(bandAfter)}    ${delta(bandBefore, bandAfter)}   n=${bandAfter.sampleSize}`);
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
