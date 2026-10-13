import { eq, inArray } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { playerCapsules } from "@research-ts/db/schema";
import type { CapsuleGenerationResult } from "./generate";
import type { NarrativeSlots } from "./narrative-slots";

/** What a product surface reads — see `src/league-service/player.ts`'s own `capsule` field on
 *  `PlayerSeasonBody`, the one place both the peek and the full player page pick this up. */
export interface PlayerCapsuleView {
  readonly bodyCompact: string;
  readonly bodyFull: string;
  readonly source: "llm" | "template";
  /** The validated per-module sentences, or `null` when this player has none — every module then
   *  renders the template sentence it always had. Read through `narrativeSlot`, never directly. */
  readonly narrative: NarrativeSlots | null;
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
    narrative: row.narrative ?? null,
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
  return stored === null ? null : { bodyCompact: stored.bodyCompact, bodyFull: stored.bodyFull, source: stored.source, narrative: stored.narrative };
}

/** Upserts a freshly generated capsule — one row per player, always. */
export async function upsertCapsule(db: Db, playerId: string, factsHash: string, result: CapsuleGenerationResult): Promise<void> {
  const values = {
    playerId,
    factsHash,
    bodyCompact: result.compact.text,
    bodyFull: result.full.text,
    source: result.source,
    // An empty object is stored as NULL: "no slots survived" and "no narrative was ever attempted"
    // read identically to every module, and storing `{}` would only give the difference a shape
    // nothing consumes.
    narrative: Object.keys(result.narrative.slots).length === 0 ? null : { ...result.narrative.slots },
    model: result.model,
    generatedAt: new Date(),
  };
  await db
    .insert(playerCapsules)
    .values(values)
    .onConflictDoUpdate({
      target: playerCapsules.playerId,
      set: {
        factsHash: values.factsHash,
        bodyCompact: values.bodyCompact,
        bodyFull: values.bodyFull,
        source: values.source,
        narrative: values.narrative,
        model: values.model,
        generatedAt: values.generatedAt,
      },
    });
}

/**
 * THE REGENERATION QUEUE (dossier-voice round §3.5, "alive, not stock"). A player caught saying a
 * stock sentence has his `factsHash` stamped with a value no real hash can equal, which is exactly
 * the condition the sweep's own `needsGeneration` already treats as "regenerate this player". No
 * new table, no new flag, and no second rule about when a capsule is stale: the queue IS the cache
 * key the sweep already reads. The next run then recomputes his facts (recovering the real hash)
 * and writes him again, with the flagged sentence quoted into that run's own prompt.
 */
export const REGENERATE_FACTS_HASH = "stale:repetition";

/**
 * THE FRONT OF THE LINE (overruns round, 2026-09-08). A player whose stored read was WRITTEN and
 * whose regeneration fell to the template is stamped with this hash as his template row is
 * written, and the sweep processes stamped rows before the board order. The same mechanism as the
 * repetition queue above (the queue is the cache key), one value apart so the two reasons stay
 * distinguishable in the table. One-shot by construction: his row is template-sourced after the
 * demotion, so a second failure is an ordinary template row and is never stamped again.
 */
export const RETRY_FIRST_FACTS_HASH = "stale:demoted";

export async function queueCapsuleRegeneration(db: Db, playerIds: readonly string[]): Promise<number> {
  if (playerIds.length === 0) return 0;
  const updated = await db
    .update(playerCapsules)
    .set({ factsHash: REGENERATE_FACTS_HASH })
    .where(inArray(playerCapsules.playerId, playerIds))
    .returning({ playerId: playerCapsules.playerId });
  return updated.length;
}
