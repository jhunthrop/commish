// THE TYPESCRIPT CASES, one per Python case of the same name (`research/parity/cases/`). Each calls
// the function production calls (the job step, or the operator script's own sequence), with the
// parity clock wherever production reads a clock.
import { seedPlayers } from "@/data/seed/seed-players";
import { crosswalkInputs, crosswalkRows, recordCrosswalk, resolveCrosswalk, seedTeamDefenseUniverse } from "@/projections/crosswalk";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestDraftPicks } from "@/projections/nflverse/draft-picks";
import { ingestPlayCallersCsv, PLAY_CALLERS_CSV_PATH } from "../../../scripts/lib/play-callers-csv";
import {
  ingestCoaches,
  ingestDerivedStatLines,
  ingestGameResults,
  ingestOpponentDefence,
  ingestPlayByPlay,
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
import { runCaptureHarvestStep } from "@/jobs/defs/capture-harvest-job";
import { ingestAdpSnapshot } from "@/projections/market/adp-snapshot";
import { ingestAdpBenchmark, rosterIdentitiesFor } from "@/projections/preseason/adp-benchmark";
import { BENCHMARK_SOURCES, resolveRankings, type RosterIdentity } from "@/projections/preseason/benchmarks";
import { BOARD_FORMATS, DEFAULT_BOARD_FORMAT } from "@/projections/preseason/board-formats";
import { crossedRosterIdentities, PRODUCT_SEASON } from "@/projections/preseason/current";
import { ingestDepthCharts, ingestWeek1Rosters } from "@/projections/preseason/ingest";
import { fetchAverageDraftPosition, fetchExpertConsensus, type PublishedBoard } from "@/projections/preseason/publishers";
import { recordPreseasonRankings } from "@/projections/preseason/store";
import type { Db } from "@/db/client";
import { resolveAllPropNames } from "@/projections/odds/player-map";
import { runOddsSnapshot } from "@/projections/odds/snapshot";
import { runWinTotalsStep } from "@/jobs/defs/win-totals-job";
import { ingestWinTotalsCsv } from "../../../scripts/lib/win-totals-csv";
import { eq } from "drizzle-orm";
import { players } from "@/db/schema";
import { captureOnce } from "@/projections/capture";
import { NFL_TEAM_ABBREVIATIONS } from "@/projections/capture-feeds";
import { createTank01Client } from "@/stats/tank01/client";
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
const PBP_SEASONS = [2023, 2024];

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

/** `preseason-ingest.ts`'s own `ingestBenchmark`, which the script does not export. */
async function recordBoard(db: Db, season: number, source: string, board: PublishedBoard, identities: readonly RosterIdentity[]): Promise<void> {
  const resolution = resolveRankings(board.candidates, identities);
  await recordPreseasonRankings(
    db,
    resolution.resolved.map((row) => ({ season, source, playerId: row.playerId, rank: row.rank, asOf: board.publishedAt })),
  );
}

const KDEF_POSITIONS = new Set(["PK", "K", "DEF", "DST", "D/ST"]);

/** `preseason-ingest.ts`'s per-season body (and `kdef-adp-ingest.ts`'s, when asked), after the
 *  universe and the season's schedule they read. The scripts run `main()` on import, so their
 *  bodies are re-assembled here from the exported functions they call, step for step. */
function preseasonCase(season: number, kdef: boolean): TsCase {
  return async ({ db }) => {
    const client = createNflverseClient();
    await ingestPlayerUniverse(db, client);
    await seedTeamDefenseUniverse(db);
    await ingestSchedule(db, [season]);
    await ingestWeek1Rosters(db, season, client);
    await ingestDepthCharts(db, season, client);
    const identities = await rosterIdentitiesFor(db, season);
    for (const format of BOARD_FORMATS) {
      try {
        await ingestAdpBenchmark(db, season, format, identities);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (format !== DEFAULT_BOARD_FORMAT && /published no \d{4} board/.test(message)) continue;
        process.stderr.write(`adp ${format} FAILED: ${message}\n`);
      }
    }
    try {
      await recordBoard(db, season, BENCHMARK_SOURCES.ecr, await fetchExpertConsensus(season), identities);
    } catch (error: unknown) {
      process.stderr.write(`ecr FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    if (kdef) {
      const board = await fetchAverageDraftPosition(season);
      const candidates = board.candidates.filter((c) => KDEF_POSITIONS.has(c.position.trim().toUpperCase()));
      await recordBoard(db, season, BENCHMARK_SOURCES.adp, { ...board, candidates }, await rosterIdentitiesFor(db, season));
    }
  };
}

export const TS_CASES: Readonly<Record<string, TsCase>> = {
  // The season-week job's props step (`realSnapshotProps`), then the preseason job's resolve.
  "odds-snapshot-and-resolve": async ({ db }) => {
    await ingestPlayerUniverse(db, createNflverseClient());
    await runOddsSnapshot(db, "replay");
    await resolveAllPropNames(db);
  },
  // The schedule the backfill reads its week instants from; the script itself runs after this.
  "odds-backfill": async ({ db }) => {
    await ingestSchedule(db, [2025]);
  },
  "win-totals-seed": async ({ db }) => {
    await ingestWinTotalsCsv(db);
  },
  "win-totals-job": async ({ db, now }) => {
    await ingestSchedule(db, [2026]);
    await runWinTotalsStep(db, { now: () => now.toISOString() }, { season: 2026 });
  },
  "preseason-2025": preseasonCase(2025, true),
  "preseason-2026-live": preseasonCase(2026, false),
  "adp-snapshot": async ({ db, now }) => {
    const client = createNflverseClient();
    await ingestPlayerUniverse(db, client);
    await seedTeamDefenseUniverse(db);
    await ingestSchedule(db, [2026]);
    await ingestWeek1Rosters(db, 2026, client);
    await ingestAdpSnapshot(db, { now: () => now });
  },
  // `scripts/ingest-current-ecr.ts`, after the crosswalk it requires.
  "current-ecr": async (ctx) => {
    await ingestPlayerUniverse(ctx.db, createNflverseClient());
    await seed(ctx, 0);
    await seedTeamDefenseUniverse(ctx.db);
    const { providers, universe, teamDefenses } = await crosswalkInputs(ctx.db);
    await recordCrosswalk(ctx.db, crosswalkRows(resolveCrosswalk(providers, universe, teamDefenses), ctx.now));
    await recordBoard(ctx.db, PRODUCT_SEASON, BENCHMARK_SOURCES.ecr, await fetchExpertConsensus(PRODUCT_SEASON), await crossedRosterIdentities(ctx.db));
  },
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
  "coaches-seed": async ({ db }) => {
    await ingestPlayCallersCsv(db, PLAY_CALLERS_CSV_PATH);
  },
  // `scripts/projection-context.ts`'s sequence, after the universe and the coaches seed it requires.
  "nflverse-context": async ({ db }) => {
    const client = createNflverseClient();
    await ingestPlayerUniverse(db, client);
    await ingestPlayCallersCsv(db, PLAY_CALLERS_CSV_PATH);
    await ingestSchedule(db, PBP_SEASONS);
    for (const season of PBP_SEASONS) await ingestPlayByPlay(db, client, season);
    await ingestCoaches(db, PBP_SEASONS);
    await ingestOpponentDefence(db, PBP_SEASONS);
  },
  "nflverse-derived-stat-lines": afterUniverse(async ({ db }) => {
    await ingestDerivedStatLines(db, createNflverseClient(), 2025);
  }),
  "tank01-roster-and-lines": async (ctx) => {
    await seed(ctx, 2);
  },
  "tank01-schedule": async ({ db }) => {
    await ingestTank01Schedule(db, tank01Provider(), UNMETERED);
  },
  // `scripts/backfill-headshots.ts`'s loop, on a provider of its own (the script's `getStatsProvider()`
  // is this provider behind a Redis-backed ledger, which a replay has no use for).
  "tank01-headshots": async (ctx) => {
    await seed(ctx, 0);
    for (const player of (await tank01Provider().listPlayers()).filter((p) => p.headshotUrl !== null)) {
      await ctx.db.update(players).set({ headshotUrl: player.headshotUrl }).where(eq(players.id, player.id)).returning({ id: players.id });
    }
  },
  "tank01-adp": async (ctx) => {
    await seed(ctx, 0);
    await ingestAdp(ctx.db, tank01Provider(), UNMETERED);
  },
  // `captureOnce` with every feed, the operator's `stats:capture` pass without its Redis freshness keys.
  "tank01-capture-all": async ({ db, now }) => {
    await captureOnce({
      db,
      client: createTank01Client({ apiKey: "replay" }),
      clock: { now: () => now.toISOString() },
      budget: { reserve: async () => ({ granted: true }) },
      season: 2026,
      week: 1,
      teams: NFL_TEAM_ABBREVIATIONS,
      isFresh: async () => false,
      markFresh: async () => {},
    });
  },
  // The capture-harvest job's step, fired twice an hour apart on the same recordings.
  "tank01-capture-harvest": async ({ db, now }) => {
    const later = new Date(now.getTime() + 3_600_000);
    for (const firedAt of [now, later]) {
      const clock = { now: () => firedAt.toISOString() };
      await runCaptureHarvestStep(db, clock, { firedAt: firedAt.toISOString() }, { apiKey: "replay" });
    }
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
