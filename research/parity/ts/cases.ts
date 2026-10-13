// THE TYPESCRIPT CASES, one per Python case of the same name (`research/parity/cases/`).
//
// THREE KINDS OF ORACLE, AND WHICH IS WHICH:
//
// 1. A LIBRARY FUNCTION production calls: the job step or the in-season task (`realIngestStats`,
//    `realSnapshotProps`, `harvestCaptures`, `refreshWinTotals`, `snapshotPreseasonProps`,
//    `ingestAdpSnapshot`), or the exported ingest an operator script is a one-line wrapper around
//    (`ingestPlayerUniverse`, `ingestSchedule` and its two narrowings, `ingestInjuryReports`,
//    `ingestInjuries`, `ingestDerivedStatLines`, `captureOnce`, `seedPlayers`, the stats pipeline's
//    schedule and ADP). The case calls it, with the parity clock where production reads a clock.
//
// 2. AN OPERATOR SCRIPT RUN AS IS (`Case.ts_scripts`, run by the harness under `preload.ts` after
//    the case here has landed its prerequisites): coaches-ingest, projection-context,
//    roster-weeks-ingest, draft-picks-ingest, kdef-backfill, preseason-ingest, kdef-adp-ingest,
//    build-crosswalk, ingest-current-ecr, vegas-win-totals-ingest and odds-props-backfill. The
//    script's own body is the oracle, exit status included.
//
// 3. A SCRIPT RE-ASSEMBLED HERE, only where running it as is cannot work: backfill-headshots.ts,
//    whose provider is the app's Redis-metered ledger. Its body is hashed (`REASSEMBLED`), and the
//    harness fails if the script changes, so an edit to it cannot drift from the copy unseen.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { players } from "@research-ts/db/schema";
import { captureOnce } from "@research-ts/projections/capture";
import { NFL_TEAM_ABBREVIATIONS } from "@research-ts/projections/capture-feeds";
import { seedTeamDefenseUniverse } from "@research-ts/projections/crosswalk";
import { harvestCaptures } from "@research-ts/projections/harvest";
import { ingestAdpSnapshot } from "@research-ts/projections/market/adp-snapshot";
import { createNflverseClient } from "@research-ts/projections/nflverse/client";
import {
  ingestDerivedStatLines,
  ingestGameResults,
  ingestInjuryReports,
  ingestPlayerUniverse,
  ingestPointsAllowed,
  ingestSchedule,
} from "@research-ts/projections/nflverse/ingest";
import { ingestInjuries } from "@research-ts/projections/nflverse/injuries";
import { resolveAllPropNames } from "@research-ts/projections/odds/player-map";
import { snapshotPreseasonProps } from "@research-ts/projections/odds/preseason-snapshot";
import { ingestWeek1Rosters } from "@research-ts/projections/preseason/ingest";
import { realIngestStats, realSnapshotProps } from "@research-ts/projections/season-week/deps";
import { refreshWinTotals } from "@research-ts/projections/vegas/win-totals-refresh";
import { createTank01Client } from "@research-ts/stats/tank01/client";
import { seedPlayers } from "@/data/seed/seed-players";
import { ingestAdp } from "@/stats-pipeline/adp";
import type { RequestBudget } from "@/stats-pipeline/budget";
import { ingestSchedule as ingestTank01Schedule } from "@/stats-pipeline/schedule";
import type { StatsProvider } from "@/stats/provider";
import { createTank01StatsProvider } from "@/stats/tank01/tank01-stats-provider";
import type { TsCase, TsCaseContext } from "./run";

/** Each re-assembled script and the sha256 of the body this file copies. */
const REASSEMBLED: Readonly<Record<string, string>> = {
  "scripts/backfill-headshots.ts": "f95b302942051692e1bdb172aa44b89d994cef084afc769841ee4bc7bb6a4da6",
};

function assertReassembledUnchanged(script: string): void {
  const body = readFileSync(join(process.cwd(), script));
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== REASSEMBLED[script]) {
    throw new Error(
      `${script} changed (sha256 ${actual}); its re-assembly in research/parity/ts/cases.ts must be re-read against it and ` +
        "the recorded hash updated in the same commit.",
    );
  }
}

/** `PRESEASON_NOW` in `parity/cases/preseason.py`: an instant before the 2026 opener. */
const PRESEASON_FIRED_AT = "2026-08-20T12:00:00.000Z";
const SCHEDULE_SEASONS = [2023, 2024, 2025, 2026];
const CONTEXT_SEASONS = [2024, 2025];
const UNMETERED = { reserveBackfill: async () => ({ granted: true }) } as unknown as RequestBudget;

function tank01Provider(lastWeekOfSeason?: number): StatsProvider {
  const provider = createTank01StatsProvider({ apiKey: "replay", season: 2026 });
  return lastWeekOfSeason === undefined ? provider : { ...provider, lastWeekOfSeason };
}

/** `seedPlayers` refuses a database it cannot verify is disposable; the parity scratch database is. */
async function seed(ctx: TsCaseContext, lastWeekOfSeason: number): Promise<void> {
  process.env.ALLOW_DESTRUCTIVE_SEED = "1";
  await seedPlayers(ctx.db, tank01Provider(lastWeekOfSeason));
}

async function universe({ db }: TsCaseContext): Promise<void> {
  await ingestPlayerUniverse(db, createNflverseClient());
}

async function universeWithDefenses(ctx: TsCaseContext): Promise<void> {
  await universe(ctx);
  await seedTeamDefenseUniverse(ctx.db);
}

function seasonCase(season: number): TsCase {
  return async ({ db }) => {
    await realIngestStats(db, season);
  };
}

/** The setup a script case needs before its scripts run; nothing more. */
const SETUP_ONLY: TsCase = async () => {};

export const TS_CASES: Readonly<Record<string, TsCase>> = {
  "nflverse-universe": universe,
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
  "nflverse-injury-reports": async (ctx) => {
    await universe(ctx);
    await ingestInjuryReports(ctx.db, createNflverseClient(), CONTEXT_SEASONS);
  },
  "nflverse-injury-archive": async (ctx) => {
    await universe(ctx);
    await ingestInjuries(ctx.db, createNflverseClient(), CONTEXT_SEASONS);
  },
  "nflverse-roster-weeks": universe,
  "nflverse-draft-picks": universe,
  "nflverse-kdef": universe,
  "coaches-seed": SETUP_ONLY,
  "nflverse-context": universe,
  "nflverse-derived-stat-lines": async (ctx) => {
    await universe(ctx);
    await ingestDerivedStatLines(ctx.db, createNflverseClient(), 2025);
  },
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
  // backfill-headshots.ts, RE-ASSEMBLED (see the header): its loop, on a provider of its own.
  "tank01-headshots": async (ctx) => {
    assertReassembledUnchanged("scripts/backfill-headshots.ts");
    await seed(ctx, 0);
    for (const player of (await tank01Provider().listPlayers()).filter((p) => p.headshotUrl !== null)) {
      await ctx.db.update(players).set({ headshotUrl: player.headshotUrl }).where(eq(players.id, player.id)).returning({ id: players.id });
    }
  },
  crosswalk: async (ctx) => {
    await seed(ctx, 0);
  },
  // `captureOnce` with every feed: the operator's capture pass without its Redis freshness keys.
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
  // The in-season capture task, fired twice an hour apart on the same recordings.
  "tank01-capture-harvest": async ({ db, now }) => {
    const later = new Date(now.getTime() + 3_600_000);
    for (const firedAt of [now, later]) {
      await harvestCaptures(db, { now: () => firedAt.toISOString() }, { firedAt: firedAt.toISOString() }, { apiKey: "replay" });
    }
  },
  "preseason-2025": async (ctx) => {
    await universeWithDefenses(ctx);
    await ingestSchedule(ctx.db, [2025]);
  },
  "preseason-2026-live": async (ctx) => {
    await universeWithDefenses(ctx);
    await ingestSchedule(ctx.db, [2026]);
  },
  "adp-snapshot": async (ctx) => {
    await universeWithDefenses(ctx);
    await ingestSchedule(ctx.db, [2026]);
    await ingestWeek1Rosters(ctx.db, 2026, createNflverseClient());
    await ingestAdpSnapshot(ctx.db, { now: () => ctx.now });
  },
  "current-ecr": async (ctx) => {
    await seed(ctx, 0);
  },
  "odds-snapshot-and-resolve": async (ctx) => {
    await universe(ctx);
    await realSnapshotProps(ctx.db);
    await resolveAllPropNames(ctx.db);
  },
  "props-preseason-job": async (ctx) => {
    await universe(ctx);
    await ingestSchedule(ctx.db, [2026]);
    // Fired before the opener (the gate reads the fire), running at the recording's clock (the
    // snapshot's window reads the wall clock), as `parity/cases/odds.py` runs it.
    await snapshotPreseasonProps(ctx.db, { now: () => ctx.now.toISOString() }, { firedAt: PRESEASON_FIRED_AT });
  },
  "odds-backfill": async ({ db }) => {
    await ingestSchedule(db, [2025]);
  },
  "win-totals-seed": SETUP_ONLY,
  "win-totals-job": async ({ db, now }) => {
    await ingestSchedule(db, [2026]);
    await refreshWinTotals(db, { now: () => now.toISOString() }, { season: 2026 });
  },
};
