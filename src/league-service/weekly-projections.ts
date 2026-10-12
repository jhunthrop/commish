import { desc, eq } from "drizzle-orm";
import type { getDb } from "@research-ts/db/client";
import { captureSnapshots } from "@research-ts/db/schema";
import { createTtlMemo } from "@research-ts/lib/cache/ttl-memo";
import { REFERENCE_MEMO_CONFIG } from "@research-ts/reference/reference-memo-config";

type Db = ReturnType<typeof getDb>;

/** Memoized per process (Neon cost audit finding 7): the newest capture's whole jsonb payload
 *  (35 KB and up) was read on every league room render. See `REFERENCE_MEMO_CONFIG`. */
const projectionsMemo = createTtlMemo<ReadonlyMap<string, number>>(REFERENCE_MEMO_CONFIG.weeklyProjectionsTtlMs);

/**
 * PPR projections for one week, keyed by our player id, read from the latest
 * `tank01_projections` capture (the harvest widening, 2026-08-30). Tank01's `playerID` IS our
 * player id for listed players, and a team defense maps through the same `DST-{teamAbv}` mint
 * every other feed uses (`TANK01_CONFIG.defensePlayerIdPrefix`).
 *
 * Law 7 guard: the snapshot names the week it was captured for, and a snapshot for a DIFFERENT
 * week answers with an empty map — a stale projection shown as this week's is an invented
 * number, and the column's dash is the honest alternative.
 */
export function weeklyProjectionsByPlayerId(db: Db, week: number): Promise<ReadonlyMap<string, number>> {
  return projectionsMemo.get(`week:${week}`, () => readWeeklyProjectionsByPlayerId(db, week));
}

async function readWeeklyProjectionsByPlayerId(db: Db, week: number): Promise<ReadonlyMap<string, number>> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_projections"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  if (snapshot === undefined) return new Map();
  const body = snapshot.payload as Record<string, unknown> | null;
  if (typeof body !== "object" || body === null || Number(body.week) !== week) return new Map();

  const projections = new Map<string, number>();
  const players = body.playerProjections;
  if (typeof players === "object" && players !== null) {
    for (const [playerId, raw] of Object.entries(players as Record<string, unknown>)) {
      const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const defaults = typeof entry.fantasyPointsDefault === "object" && entry.fantasyPointsDefault !== null ? (entry.fantasyPointsDefault as Record<string, unknown>) : {};
      const ppr = Number(defaults.PPR);
      if (Number.isFinite(ppr)) projections.set(playerId, ppr);
    }
  }
  const defenses = body.teamDefenseProjections;
  if (typeof defenses === "object" && defenses !== null) {
    for (const raw of Object.values(defenses as Record<string, unknown>)) {
      const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
      const abbreviation = typeof entry.teamAbv === "string" ? entry.teamAbv : "";
      // A DST projection's fantasyPointsDefault arrives as a scalar, not the per-scoring map.
      const points = Number(entry.fantasyPointsDefault);
      if (abbreviation !== "" && Number.isFinite(points)) projections.set(`DST-${abbreviation}`, points);
    }
  }
  return projections;
}
