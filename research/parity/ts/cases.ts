// THE TYPESCRIPT CASES, one per Python case of the same name (`research/parity/cases/`). Each calls
// the function production calls (the job step, or the operator script's own sequence), with the
// parity clock wherever production reads a clock.
import { seedPlayers } from "@/data/seed/seed-players";
import { crosswalkInputs, crosswalkRows, recordCrosswalk, resolveCrosswalk, seedTeamDefenseUniverse } from "@/projections/crosswalk";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestDraftPicks } from "@/projections/nflverse/draft-picks";
import {
  ingestGameResults,
  ingestInjuryReports,
  ingestPlayerUniverse,
  ingestPointsAllowed,
  ingestSchedule,
  ingestSeason,
  scheduleWeekAsOf,
} from "@/projections/nflverse/ingest";
import { ingestInjuries } from "@/projections/nflverse/injuries";
import { ingestKickingWeeks } from "@/projections/nflverse/kicking-weeks";
import { ingestRosterWeeks } from "@/projections/nflverse/roster-weeks";
import { SCHEDULE_SOURCE_CONFIG } from "@/projections/nflverse/schedule";
import { ingestTeamDefenseWeeks } from "@/projections/nflverse/team-defense-weeks";
import { ingestAdp } from "@/stats-pipeline/adp";
import type { RequestBudget } from "@/stats-pipeline/budget";
import { ingestSchedule as ingestTank01Schedule } from "@/stats-pipeline/schedule";
import { createTank01StatsProvider } from "@/stats/tank01/tank01-stats-provider";
import type { StatsProvider } from "@/stats/provider";
import type { TsCase } from "./run";

/** `realIngestStats` (`src/jobs/season-week/deps.ts`) for one season: the season-week job's path. */
function seasonCase(season: number): TsCase {
  return async ({ db }) => {
    const client = createNflverseClient();
    const universe = await ingestPlayerUniverse(db, client);
    const scheduleAsOf = (await scheduleWeekAsOf([season])).get(season);
    await ingestSeason(db, client, universe, season, scheduleAsOf);
  };
}

/** The context and archive ingests read the stored universe, so each case lands it first. */
function afterUniverse(run: TsCase): TsCase {
  return async (ctx) => {
    await ingestPlayerUniverse(ctx.db, createNflverseClient());
    await run(ctx);
  };
}

const CONTEXT_SEASONS = [2024, 2025];
const SCHEDULE_SEASONS = [2023, 2024, 2025, 2026];
const KDEF_SEASONS = [2024, 2025];

const UNMETERED = { reserveBackfill: async () => ({ granted: true }) } as unknown as RequestBudget;

function tank01Provider(lastWeekOfSeason?: number): StatsProvider {
  const provider = createTank01StatsProvider({ apiKey: "replay", season: 2026 });
  return lastWeekOfSeason === undefined ? provider : { ...provider, lastWeekOfSeason };
}

/** `seedPlayers` refuses a database it cannot verify is disposable; the parity scratch database is. */
async function seed(ctx: Parameters<TsCase>[0], lastWeekOfSeason: number): Promise<void> {
  process.env.ALLOW_DESTRUCTIVE_SEED = "1";
  await seedPlayers(ctx.db, tank01Provider(lastWeekOfSeason));
}

export const TS_CASES: Readonly<Record<string, TsCase>> = {
  "nflverse-universe": async ({ db }) => {
    await ingestPlayerUniverse(db, createNflverseClient());
  },
  "nflverse-season-2024": seasonCase(2024),
  "nflverse-season-2012": seasonCase(2012),
  "nflverse-season-2025": seasonCase(2025),
  "nflverse-schedule": async ({ db }) => {
    await ingestSchedule(db, SCHEDULE_SEASONS);
  },
  "nflverse-game-results": async ({ db }) => {
    await ingestGameResults(db, SCHEDULE_SEASONS);
  },
  "nflverse-points-allowed": async ({ db }) => {
    await ingestPointsAllowed(db, SCHEDULE_SEASONS);
  },
  "nflverse-injury-reports": afterUniverse(async ({ db }) => {
    await ingestInjuryReports(db, createNflverseClient(), CONTEXT_SEASONS);
  }),
  "nflverse-injury-archive": afterUniverse(async ({ db }) => {
    await ingestInjuries(db, createNflverseClient(), CONTEXT_SEASONS);
  }),
  "nflverse-roster-weeks": afterUniverse(async ({ db }) => {
    await ingestRosterWeeks(db, createNflverseClient(), CONTEXT_SEASONS);
  }),
  "nflverse-draft-picks": afterUniverse(async ({ db }) => {
    await ingestDraftPicks(db, createNflverseClient());
  }),
  // `scripts/kdef-backfill.ts`: the 32 synthetic defenses, then kicking weeks, then team defense weeks.
  "nflverse-kdef": afterUniverse(async ({ db }) => {
    const client = createNflverseClient();
    await seedTeamDefenseUniverse(db);
    await ingestKickingWeeks(db, client, KDEF_SEASONS);
    await ingestTeamDefenseWeeks(db, client, KDEF_SEASONS, createNflverseClient({ baseUrl: SCHEDULE_SOURCE_CONFIG.baseUrl }));
  }),
  "tank01-roster-and-lines": async (ctx) => {
    await seed(ctx, 2);
  },
  "tank01-schedule": async ({ db }) => {
    await ingestTank01Schedule(db, tank01Provider(), UNMETERED);
  },
  "tank01-adp": async (ctx) => {
    await seed(ctx, 0);
    await ingestAdp(ctx.db, tank01Provider(), UNMETERED);
  },
  // `scripts/build-crosswalk.ts`, with the parity clock where the script reads `new Date()`.
  crosswalk: async (ctx) => {
    await ingestPlayerUniverse(ctx.db, createNflverseClient());
    await seed(ctx, 0);
    await seedTeamDefenseUniverse(ctx.db);
    const { providers, universe, teamDefenses } = await crosswalkInputs(ctx.db);
    await recordCrosswalk(ctx.db, crosswalkRows(resolveCrosswalk(providers, universe, teamDefenses), ctx.now));
  },
};
