/**
 * `sim_runs`' LIFECYCLE — create, cache lookup, and the transitions a sim's own job steps drive.
 * A repeat request finds its way back here first (`findCachedRun`) before anything is enqueued
 * or computed, which is what makes the cache actually save the work rather than only the row.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { simRuns } from "@/db/schema";
import type { JsonObject } from "@/domain/audit";
import type { SimConfig, StoredSimSummary } from "./types";

/** The exact index name `schema.ts`'s `simRuns` table names for the "at most one in-flight run
 *  per (user, config, board generation)" constraint — named once so `createSimRun`'s own conflict
 *  catch can never drift from the migration that actually creates it. */
export const SIM_RUNS_INFLIGHT_INDEX = "sim_runs_inflight_idx";

/** A stable hash of a `SimConfig` — key order never matters, since every field is spelled out
 *  explicitly rather than serialized from whatever order the caller built the object in. */
export function hashSimConfig(config: SimConfig): string {
  const canonical = {
    teamCount: config.teamCount,
    rosterSlots: config.rosterSlots.map((slot) => ({ slot: slot.slot, count: slot.count, eligiblePositions: [...slot.eligiblePositions] })),
    slot: config.slot,
    rounds: config.rounds,
    runs: config.runs,
    sharpness: config.sharpness,
    seed: config.seed,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface SimRunRow {
  readonly id: string;
  readonly userId: string;
  readonly leagueId: string | null;
  readonly config: SimConfig;
  readonly configHash: string;
  readonly boardGeneration: string;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "abandoned";
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
  readonly summary: StoredSimSummary | null;
  readonly error: string | null;
}

function toRow(raw: typeof simRuns.$inferSelect): SimRunRow {
  return {
    id: raw.id,
    userId: raw.userId,
    leagueId: raw.leagueId,
    config: raw.config as unknown as SimConfig,
    configHash: raw.configHash,
    boardGeneration: raw.boardGeneration,
    status: raw.status,
    requestedAt: raw.requestedAt,
    finishedAt: raw.finishedAt,
    summary: raw.summary as unknown as StoredSimSummary | null,
    error: raw.error,
  };
}

/** The user's own prior run of the identical config against the identical board generation, if
 *  one has already succeeded — the whole cache. Never crosses users (see `schema.ts`'s own
 *  docblock for why the scope was drawn there). */
export async function findCachedRun(db: Db, userId: string, configHash: string, boardGeneration: string): Promise<SimRunRow | null> {
  const [row] = await db
    .select()
    .from(simRuns)
    .where(and(eq(simRuns.userId, userId), eq(simRuns.configHash, configHash), eq(simRuns.boardGeneration, boardGeneration), eq(simRuns.status, "succeeded")))
    .orderBy(desc(simRuns.requestedAt))
    .limit(1);
  return row === undefined ? null : toRow(row);
}

/** The user's own CURRENTLY IN-FLIGHT (pending/running) run of the identical config against the
 *  identical board generation, if one exists — what a caller that lost the `createSimRun` race
 *  (fix round 1, MEDIUM 1) reads back instead of the row it failed to insert. At most one such
 *  row can ever exist, by `SIM_RUNS_INFLIGHT_INDEX`'s own constraint, so `limit(1)` is a safety
 *  net rather than a real ambiguity to resolve. */
export async function findInFlightRun(db: Db, userId: string, configHash: string, boardGeneration: string): Promise<SimRunRow | null> {
  const [row] = await db
    .select()
    .from(simRuns)
    .where(
      and(
        eq(simRuns.userId, userId),
        eq(simRuns.configHash, configHash),
        eq(simRuns.boardGeneration, boardGeneration),
        inArray(simRuns.status, ["pending", "running"]),
      ),
    )
    .orderBy(desc(simRuns.requestedAt))
    .limit(1);
  return row === undefined ? null : toRow(row);
}

export interface CreateSimRunInput {
  readonly id: string;
  readonly userId: string;
  readonly leagueId: string | null;
  readonly config: SimConfig;
  readonly configHash: string;
  readonly boardGeneration: string;
}

export type CreateSimRunResult =
  | { readonly outcome: "created" }
  /** Fix round 1, MEDIUM 1: another concurrent, identical request won the race — `existing` is
   *  ITS row, already in flight for the exact same `(user, configHash, boardGeneration)`. The
   *  caller's own freshly-generated `input.id` was never written; nothing to clean up. */
  | { readonly outcome: "joined_in_flight"; readonly existing: SimRunRow };

/**
 * Inserts a fresh `pending` row, UNLESS a concurrent request already has one in flight for the
 * identical `(userId, configHash, boardGeneration)` — `SIM_RUNS_INFLIGHT_INDEX` makes that a
 * unique-violation at the database, caught here (`isUniqueViolation`, the same idiom
 * `trades.ts`'s open-fingerprint guard already uses) rather than raced past it in application
 * code, which is the only place a check-then-act gap can ever be fully closed.
 */
export async function createSimRun(db: Db, input: CreateSimRunInput): Promise<CreateSimRunResult> {
  try {
    await db.insert(simRuns).values({
      id: input.id,
      userId: input.userId,
      leagueId: input.leagueId,
      config: input.config as unknown as JsonObject,
      configHash: input.configHash,
      boardGeneration: input.boardGeneration,
      status: "pending",
    });
    return { outcome: "created" };
  } catch (error: unknown) {
    if (!isUniqueViolation(error, SIM_RUNS_INFLIGHT_INDEX)) throw error;
    const existing = await findInFlightRun(db, input.userId, input.configHash, input.boardGeneration);
    // The conflict just proved a row exists; a `null` here would mean it finished (and left
    // in-flight status) between the failed insert and this read — vanishingly unlikely for a
    // sync-path run and still handled honestly rather than assumed away.
    if (existing === null) throw error;
    return { outcome: "joined_in_flight", existing };
  }
}

export async function markSimRunRunning(db: Db, id: string): Promise<void> {
  await db.update(simRuns).set({ status: "running" }).where(eq(simRuns.id, id));
}

export async function markSimRunSucceeded(db: Db, id: string, summary: StoredSimSummary): Promise<void> {
  await db
    .update(simRuns)
    .set({ status: "succeeded", finishedAt: new Date(), summary: summary as unknown as JsonObject })
    .where(eq(simRuns.id, id));
}

export async function markSimRunFailed(db: Db, id: string, error: string): Promise<void> {
  await db.update(simRuns).set({ status: "failed", finishedAt: new Date(), error }).where(eq(simRuns.id, id));
}

export async function getSimRun(db: Db, id: string): Promise<SimRunRow | null> {
  const [row] = await db.select().from(simRuns).where(eq(simRuns.id, id)).limit(1);
  return row === undefined ? null : toRow(row);
}

/** The caller's own recent runs, newest first — the Simulator page's "my sims" list. */
export async function listSimRunsForUser(db: Db, userId: string, limit: number): Promise<readonly SimRunRow[]> {
  const rows = await db.select().from(simRuns).where(eq(simRuns.userId, userId)).orderBy(desc(simRuns.requestedAt)).limit(limit);
  return rows.map(toRow);
}

/** How many of the caller's own runs are still in flight (`pending`/`running`) — the fairness
 *  budget `SIM_CONFIG.maxInFlightPerUser` is measured against. */
export async function countInFlightSimRuns(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ id: simRuns.id })
    .from(simRuns)
    .where(and(eq(simRuns.userId, userId), inArray(simRuns.status, ["pending", "running"])));
  return rows.length;
}
