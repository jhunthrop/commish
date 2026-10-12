// Fits the per-game performance variance table for the four skill positions and publishes it to
// the model artifact store as the next version of `preseason/game-variance-skill`, writing the
// matching record under `data/model-artifacts/` (file-sourced data round, 2026-09-09; the
// generated `game-variance-fitted.ts` this used to write is gone).
// Run: npm run projections:game-variance:fit
//
// FIT ON 2023-2024, PER THIS CALIBRATION ROUND'S OWN REGISTER DISCIPLINE — 2025 scores (Task 5's
// backtest), 2026 is never touched. A different window from the rest of the preseason model's
// `FIT_SEASONS` (2021, 2022), for the same reason `fit.ts`'s rookie durability prior gets one: this
// table is new work from this calibration round, not a re-fit of something nobody found wrong.
//
// THE CODE SERVES THE NEW VERSION ONLY WHEN A REVIEWED COMMIT BUMPS THE PIN
// (`GAME_VARIANCE_SKILL_ARTIFACT.version`); this script prints the pin to bump.
import { createDb } from "@research/db/client";
import { draftVersionOf } from "@research/projections/model/artifacts";
import { fitGameVariance, loadGameVarianceObservations, VARIANCE_POSITIONS, type GameVariancePriors, type GameVarianceObservation } from "@research/projections/preseason/game-variance";
import { GAME_VARIANCE_SKILL_ARTIFACT } from "@research/projections/preseason/game-variance-artifacts";
import { recordAndPublishFit } from "./lib/model-artifact-records";

const TRAIN_SEASONS = [2023, 2024];
const HELD_OUT_SEASONS = [2025, 2026];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:game-variance:fit\`, which loads .env.local.`);
  }
  return value;
}

function printTable(priors: GameVariancePriors, observations: readonly GameVarianceObservation[]): void {
  console.log(`PER-GAME VARIANCE, fit on ${observations.length} player-seasons across ${TRAIN_SEASONS.join(", ")}`);
  for (const playerClass of ["rookie", "veteran"] as const) {
    console.log(`\n  ${playerClass}`);
    for (const position of VARIANCE_POSITIONS) {
      const variance = priors[playerClass][position];
      // K and DEF are fitted by `kdef-fit.ts` from the kicking and team-defence archives, because
      // this script's own observation loader reads `player_week_observations`, which holds neither.
      // An absent cell is reported as absent rather than printed as a zero somebody would read as
      // a measurement.
      if (variance === undefined) {
        console.log(`    ${position.padEnd(4)} not fitted here (see scripts/kdef-fit.ts)`);
        continue;
      }
      const n = observations.filter((o) => o.playerClass === playerClass && o.position === position && o.weeklyPoints.length >= 2).length;
      console.log(`    ${position.padEnd(4)} variance ${variance.toFixed(2)} (sd ${Math.sqrt(variance).toFixed(2)}, n=${n} player-seasons)`);
    }
  }
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  try {
    const observations = await loadGameVarianceObservations(db, TRAIN_SEASONS);
    const priors = fitGameVariance(observations, { heldOutSeasons: HELD_OUT_SEASONS });
    printTable(priors, observations);

    const published = await recordAndPublishFit(db, draftVersionOf(GAME_VARIANCE_SKILL_ARTIFACT), priors, {
      fitStamp: new Date(),
      fittedOn: `Fit on ${TRAIN_SEASONS.join(" and ")}; ${HELD_OUT_SEASONS.join(" and ")} held out`,
    });
    console.log(`\n${published.outcome}: ${published.name} v${published.version} (${published.path})`);
    console.log(`Pin GAME_VARIANCE_SKILL_ARTIFACT.version = ${published.version} in src/projections/preseason/game-variance-artifacts.ts to serve it.`);
  } finally {
    await db.$client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
