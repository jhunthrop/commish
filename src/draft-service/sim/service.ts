/**
 * `POST /api/draft/sim`'s WHOLE DECISION TREE, in one function so the route file stays a thin
 * wire: resolve the league (or the generic default), build the evidence pool, check the cache,
 * check the per-user in-flight budget, then either run synchronously (spec §5,
 * `SIM_CONFIG.syncRunThreshold`) or enqueue the job and return the pending row.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { leagues } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import { enqueueJob } from "@/jobs/store";
import { leagueBoardFormat } from "@/league-service/board-format";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { simJob, SIM_JOB_NAME } from "@/jobs/defs/sim-job";
import { SIM_CONFIG } from "./config";
import { evidencePoolFor } from "./evidence";
import { simulateAllSlots, simulateDrafts } from "./simulate";
import { countInFlightSimRuns, createSimRun, findCachedRun, getSimRun, hashSimConfig, markSimRunFailed, markSimRunSucceeded, type SimRunRow } from "./store";
import type { SimConfig } from "./types";

const GENERIC_SHAPE = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS as readonly RosterSlotConfig[] };

export interface RequestSimRunInput {
  readonly leagueId: string | null;
  readonly slot: number | "all";
  readonly rounds: number;
  readonly runs: number;
  readonly sharpness: number;
}

export type RequestSimRunResult =
  | { readonly outcome: "cached" | "completed"; readonly run: SimRunRow }
  | { readonly outcome: "queued"; readonly run: SimRunRow }
  | { readonly outcome: "over_budget" }
  | { readonly outcome: "league_not_found" };

/** A stable, deterministic seed from every user-controllable knob EXCEPT the seed itself: two
 *  requests with identical parameters always sim identically, which is both what makes the cache
 *  correct and what the brief's own "deterministic under a seed" testability requirement asks
 *  for at the service layer, not only inside `simulateDrafts`.
 *
 *  Exported so a caller that wants to LOOK UP a canonical sim without ever triggering one — the
 *  live-room Assistant's `winningBuilds` (`@/draft-service/assistant/call.ts`), which reads
 *  `findCachedRun` directly rather than through `requestSimRun` — can reconstruct the identical
 *  `SimConfig`/`configHash` a Playbook-triggered canonical run used, without a second seed
 *  formula that could quietly drift from this one. */
export function deriveSeed(shape: { readonly teamCount: number; readonly rosterSlots: readonly RosterSlotConfig[] }, input: RequestSimRunInput): number {
  const canonical = JSON.stringify({
    teamCount: shape.teamCount,
    rosterSlots: shape.rosterSlots.map((s) => ({ slot: s.slot, count: s.count, eligiblePositions: [...s.eligiblePositions] })),
    slot: input.slot,
    rounds: input.rounds,
    runs: input.runs,
    sharpness: input.sharpness,
  });
  const hex = createHash("sha256").update(canonical).digest("hex").slice(0, 8);
  return parseInt(hex, 16);
}

export async function requestSimRun(db: Db, userId: string, input: RequestSimRunInput): Promise<RequestSimRunResult> {
  let shape = GENERIC_SHAPE;
  let boardSource = BOARD_SOURCE;
  if (input.leagueId !== null) {
    const [league] = await db.select({ teamCount: leagues.teamCount, rosterSlots: leagues.rosterSlots }).from(leagues).where(eq(leagues.id, input.leagueId)).limit(1);
    if (league === undefined) return { outcome: "league_not_found" };
    shape = { teamCount: league.teamCount, rosterSlots: league.rosterSlots };
    // The league's own board (the scoring-formats round): its scoring row decides the format.
    boardSource = (await leagueBoardFormat(db, input.leagueId)).source;
  }

  const { pool, boardGeneration } = await evidencePoolFor(db, new Date(), boardSource);
  const config: SimConfig = { teamCount: shape.teamCount, rosterSlots: shape.rosterSlots, slot: input.slot, rounds: input.rounds, runs: input.runs, sharpness: input.sharpness, seed: deriveSeed(shape, input) };
  const configHash = hashSimConfig(config);

  const cached = await findCachedRun(db, userId, configHash, boardGeneration);
  if (cached !== null) return { outcome: "cached", run: cached };

  const inFlight = await countInFlightSimRuns(db, userId);
  if (inFlight >= SIM_CONFIG.maxInFlightPerUser) return { outcome: "over_budget" };

  // Fix round 1, MEDIUM 1: `countInFlightSimRuns` above and this insert are still two separate
  // statements, so two concurrent identical requests can both read the budget as available and
  // both reach here — that race is real and is NOT what closes it. What closes it is
  // `SIM_RUNS_INFLIGHT_INDEX` (`schema.ts`) plus `createSimRun`'s own conflict handling: the
  // LOSER's insert fails at the database, and it reads back the WINNER's row instead of creating
  // a genuine duplicate. The budget check above stays as the fast, un-raced common path (it still
  // correctly refuses a caller who already has `maxInFlightPerUser` DIFFERENT runs going); this is
  // the narrower, structural backstop for the identical-request race specifically.
  const id = crypto.randomUUID();
  const created = await createSimRun(db, { id, userId, leagueId: input.leagueId, config, configHash, boardGeneration });
  if (created.outcome === "joined_in_flight") return { outcome: "queued", run: created.existing };

  if (input.runs <= SIM_CONFIG.syncRunThreshold) {
    try {
      const summary = config.slot === "all" ? { bySlot: simulateAllSlots(config, pool) } : simulateDrafts({ ...config, slot: config.slot }, pool);
      await markSimRunSucceeded(db, id, summary);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await markSimRunFailed(db, id, message);
    }
    const finished = await findFreshRun(db, id);
    return { outcome: "completed", run: finished };
  }

  await enqueueJob(db, { now: () => new Date().toISOString() }, {
    name: SIM_JOB_NAME,
    idempotencyKey: `sim:${id}`,
    payload: { simRunId: id },
    maxAttempts: simJob.maxAttempts,
    runAt: new Date(),
  });
  const queued = await findFreshRun(db, id);
  return { outcome: "queued", run: queued };
}

async function findFreshRun(db: Db, id: string): Promise<SimRunRow> {
  const row = await getSimRun(db, id);
  if (row === null) throw new Error(`sim run ${id} vanished immediately after being created.`);
  return row;
}
