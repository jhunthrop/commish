import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { playerCapsules } from "@/db/schema";
import type { CapsuleGenerationResult } from "./generate";

/** What a product surface reads — see `src/league-service/player.ts`'s own `capsule` field on
 *  `PlayerSeasonBody`, the one place both the peek and the full player page pick this up. */
export interface PlayerCapsuleView {
  readonly bodyCompact: string;
  readonly bodyFull: string;
  readonly source: "llm" | "template";
}

export interface StoredPlayerCapsule extends PlayerCapsuleView {
  readonly playerId: string;
  readonly factsHash: string;
  readonly model: string | null;
  readonly generatedAt: Date;
}

function toStoredCapsule(row: typeof playerCapsules.$inferSelect): StoredPlayerCapsule {
  return {
    playerId: row.playerId,
    factsHash: row.factsHash,
    bodyCompact: row.bodyCompact,
    bodyFull: row.bodyFull,
    source: row.source,
    model: row.model,
    generatedAt: row.generatedAt,
  };
}

/** The sweep job's own read: does this player already have a row, and does its `factsHash` match
 *  the freshly computed one — the whole "recompute facts, regenerate where the hash moved" rule
 *  the spec's own AMENDED paragraph states. `null` when no row exists yet. */
export async function getStoredCapsule(db: Db, playerId: string): Promise<StoredPlayerCapsule | null> {
  const [row] = await db.select().from(playerCapsules).where(eq(playerCapsules.playerId, playerId));
  return row === undefined ? null : toStoredCapsule(row);
}

/** Every existing capsule row for `playerIds`, in one query — the sweep job's own read, so
 *  deciding who needs a fresh generation never costs one query per board player. A player with no
 *  row is simply absent from the returned map. */
export async function getStoredCapsulesFor(db: Db, playerIds: readonly string[]): Promise<ReadonlyMap<string, StoredPlayerCapsule>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db.select().from(playerCapsules).where(inArray(playerCapsules.playerId, playerIds));
  return new Map(rows.map((row) => [row.playerId, toStoredCapsule(row)] as const));
}

/** The product-surface read — `player.ts`'s own `capsule` field. `null` when the sweep has never
 *  reached this player yet (a board-irrelevant player, or one not yet swept); never a placeholder
 *  string standing in for absence. */
export async function getPlayerCapsule(db: Db, playerId: string): Promise<PlayerCapsuleView | null> {
  const stored = await getStoredCapsule(db, playerId);
  return stored === null ? null : { bodyCompact: stored.bodyCompact, bodyFull: stored.bodyFull, source: stored.source };
}

/** Upserts a freshly generated capsule — one row per player, always. */
export async function upsertCapsule(db: Db, playerId: string, factsHash: string, result: CapsuleGenerationResult): Promise<void> {
  const values = {
    playerId,
    factsHash,
    bodyCompact: result.compact.text,
    bodyFull: result.full.text,
    source: result.source,
    model: result.model,
    generatedAt: new Date(),
  };
  await db
    .insert(playerCapsules)
    .values(values)
    .onConflictDoUpdate({
      target: playerCapsules.playerId,
      set: { factsHash: values.factsHash, bodyCompact: values.bodyCompact, bodyFull: values.bodyFull, source: values.source, model: values.model, generatedAt: values.generatedAt },
    });
}
