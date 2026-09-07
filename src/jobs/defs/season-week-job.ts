// THE SEASON-WEEK JOB — the three crontab fires' one payload, rebuilt on the job contract. Five
// checkpointed steps mapping one-to-one onto `src/jobs/season-week/steps.ts`'s exported step
// functions (that file is the wall-exempt home of everything that touches the register; this
// module calls THROUGH it and never imports `src/projections/register` itself), plus a sixth of
// this module's own (see just below).
//
// A SIXTH STEP JOINED THE FIVE (peek-facts design §3.2, 2026-09-07): `peek-facts` refreshes the
// precomputed player-peek rows once the week's stats are in, which is the second of that design's
// two triggers. It is idempotent and ordinary retryable weather.
//
// THE CADENCE'S OWN LAWS SURVIVE THE MIGRATION:
//   - A props-snapshot failure is RECORDED, never fatal (the crontab-era rule that a dead
//     ODDS_API_KEY must not block the freeze). Its checkpoint says FAILED in the summary; the
//     next scheduled fire snapshots again — the cadence has always self-healed props by running
//     three times a week.
//   - A freeze REFUSED for cause is TERMINAL: past kickoff, an empty served board, a missing
//     served role — retrying any of those until it "works" would be the job system papering over
//     the register's own gates, the exact thing the brief forbids. A transient DB or network
//     error stays retryable.
//   - Every step is idempotent-or-skip already, which is what makes checkpoint resume and
//     at-least-once delivery safe here without new step logic.
import {
  RegisterRefusalError,
  freezeStep,
  gradeStep,
  defaultSeason,
  propsSnapshotStep,
  scoreboardStep,
  statsIngestStep,
  type SeasonWeekDeps,
  type SeasonWeekOptions,
  type StepResult,
} from "../season-week/steps";
import { realIngestStats, realSnapshotProps } from "../season-week/deps";
import { refreshPeekFacts } from "@/capsules/peek-facts";
import { enqueuePeekDocumentRebuildsQuietly } from "./peek-document-job";
import type { Db } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import { JOBS_CONFIG } from "../config";
import { TerminalJobError, defineJob, type AnyJobDefinition, type JobStepContext, type StepOutcome } from "../contract";

export const SEASON_WEEK_JOB_NAME = "season-week";

export interface SeasonWeekPayload {
  /** Optional override; defaults to `defaultSeason(now)` at EXECUTION time, so a schedule fire
   *  carries no season and can never bake a stale year into the queue. */
  readonly season?: number;
}

/** The two network reaches, injectable so tests run the whole job without a socket — the same
 *  seam `SeasonWeekDeps` itself draws. */
export interface SeasonWeekNetwork {
  readonly ingestStats: (db: Db, season: number) => Promise<Awaited<ReturnType<typeof realIngestStats>>>;
  readonly snapshotProps: (db: Db) => Promise<Awaited<ReturnType<typeof realSnapshotProps>>>;
}

export function parseSeasonWeekPayload(raw: JsonObject): SeasonWeekPayload {
  const season = raw.season;
  if (season === undefined) return {};
  if (typeof season !== "number" || !Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new Error(`season-week payload: season must be an integer year, got ${JSON.stringify(season)}.`);
  }
  return { season };
}

/**
 * A refusal is the REGISTER SPEAKING — each one needs an operator or the calendar, never a
 * retry. Recognised by TYPE (`RegisterRefusalError`, thrown by every `takeFreeze` refusal site
 * and by its wrap of `assertSingleGeneration`), never by message-matching: a regex over prose
 * desyncs silently the day someone edits a sentence, which is how the fix round found the
 * stitched-generations refusal uncovered. Anything else thrown through the freeze path is
 * weather (a dropped connection, a restarting database) and stays retryable.
 */
export function classifyFreezeError(error: unknown): Error {
  if (error instanceof RegisterRefusalError) {
    return new TerminalJobError(`freeze refused by the register [${error.code}]: ${error.message}`, { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

function toOutcome(result: StepResult): StepOutcome {
  return { summary: `[${result.status.toUpperCase()}] ${result.summary}`, detail: result.detail };
}

function cadence(ctx: JobStepContext, payload: SeasonWeekPayload, network: SeasonWeekNetwork): { deps: SeasonWeekDeps; options: SeasonWeekOptions } {
  return {
    deps: {
      db: ctx.db,
      clock: ctx.clock,
      ingestStats: (season) => network.ingestStats(ctx.db, season),
      snapshotProps: () => network.snapshotProps(ctx.db),
    },
    options: { season: payload.season ?? defaultSeason(new Date(ctx.clock.now())), dryRun: false, refreeze: false },
  };
}

export function seasonWeekJobWith(network: SeasonWeekNetwork): AnyJobDefinition {
  return defineJob<SeasonWeekPayload>({
    name: SEASON_WEEK_JOB_NAME,
    maxAttempts: JOBS_CONFIG.defaultMaxAttempts,
    /** One attempt hosts a full ingest + snapshot + grade + freeze comfortably; a bounded Vercel
     *  tick caps this to its remaining budget and resumes from checkpoints next tick. */
    timeoutMs: 15 * 60_000,
    backoff: JOBS_CONFIG.defaultBackoff,
    parsePayload: parseSeasonWeekPayload,
    steps: [
      {
        name: "stats-ingest",
        run: async (ctx, payload) => {
          const { deps, options } = cadence(ctx, payload, network);
          return toOutcome(await statsIngestStep(deps, options));
        },
      },
      {
        name: "props-snapshot",
        run: async (ctx, payload) => {
          const { deps, options } = cadence(ctx, payload, network);
          try {
            return toOutcome(await propsSnapshotStep(deps, options));
          } catch (error: unknown) {
            // Recorded, never fatal — see the module header. The checkpoint carries the failure
            // so the admin page shows it; the job walks on to grade and freeze.
            const message = error instanceof Error ? error.message : String(error);
            return { summary: `[FAILED] props snapshot: ${message} (recorded, not fatal; grade and freeze still run)`, detail: [] };
          }
        },
      },
      {
        name: "grade",
        run: async (ctx, payload) => {
          const { deps, options } = cadence(ctx, payload, network);
          return toOutcome(await gradeStep(deps, options));
        },
      },
      {
        name: "freeze",
        run: async (ctx, payload) => {
          const { deps, options } = cadence(ctx, payload, network);
          try {
            return toOutcome(await freezeStep(deps, options));
          } catch (error: unknown) {
            throw classifyFreezeError(error);
          }
        },
      },
      {
        name: "scoreboard",
        run: async (ctx, payload) => {
          const { deps, options } = cadence(ctx, payload, network);
          return toOutcome(await scoreboardStep(deps, options));
        },
      },
      {
        // THE PEEK-FACTS REFRESH (peek-facts design §3.2, 2026-09-07) — the second of the two
        // triggers, the nightly capsule sweep being the first. It runs LAST, after the week's stats
        // have been ingested and the register has had its say, because that is when the current
        // season's facts have actually moved. It writes the CURRENT product season's rows and no
        // other: `PRODUCT_SEASON` is the only season a peek asks about.
        //
        // ORDINARY RETRYABLE WEATHER, like every other database step here. It is also idempotent by
        // construction (`writePeekFacts`' changed-row counting), so a retried tick that reaches it
        // twice with the same clock writes nothing the second time.
        name: "peek-facts",
        run: async (ctx) => {
          const refresh = await refreshPeekFacts(ctx.db, new Date(ctx.clock.now()));
          return {
            summary: `[OK] peek facts: ${refresh.players} rows built, ${refresh.changed} changed, ${refresh.withTouchesRank} with a touches rank`,
            detail: [],
          };
        },
      },
      {
        // THE PEEK-DOCUMENT REBUILD (peek document design §3.4, row one) — the finalize event. It
        // runs after `peek-facts` for the same reason that step runs last: this is the moment the
        // current season's numbers have actually moved.
        //
        // IT REBUILDS EVERY PLAYER FOR EVERY HASH, deliberately, where the other events name a
        // handful. A finalized week is not one player's news: a new week appears on every chart, and
        // the percentile population every week and every points-per-game is judged against is the
        // whole position's season, which the new week just changed for everybody at that position.
        // Naming "the players with a changed week" would rebuild the men who played and leave every
        // one of their peers holding a percentile taken over last week's population.
        //
        // WHAT A WHOLE-HASH REBUILD ACTUALLY COSTS, stated honestly (fix round, 2026-09-07): `as_of`
        // is part of the document's key, so a build INSERTS a generation for every player rather
        // than updating one in place. That is roughly 1,719 rows and about 7 MB per scoring hash on
        // today's player universe, whatever the changed-row count reports. The changed-row count is
        // about the CONTENT, not the row count, and the three-generation prune
        // (`prunePeekDocuments`) is what keeps the store from growing with every event.
        name: "peek-documents",
        run: async (ctx, payload) => {
          const season = payload.season ?? defaultSeason(new Date(ctx.clock.now()));
          const enqueued = await enqueuePeekDocumentRebuildsQuietly(ctx.db, ctx.clock, {
            playerIds: null,
            reason: `finalize:${season}:${ctx.clock.now()}`,
          });
          return { summary: `[OK] peek documents: ${enqueued} rebuild${enqueued === 1 ? "" : "s"} enqueued, one per scoring hash in use`, detail: [] };
        },
      },
    ],
  });
}

/** The production definition — real nflverse ingest, real odds snapshot. */
export const seasonWeekJob: AnyJobDefinition = seasonWeekJobWith({
  ingestStats: realIngestStats,
  snapshotProps: realSnapshotProps,
});
