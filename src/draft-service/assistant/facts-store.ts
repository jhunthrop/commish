/**
 * THE ROOM FACTS STORE (the batched bots round, 2026-09-25, replacing the Redis store and its
 * compute lock of the draft-room performance round): the room's facts for one log sequence, held
 * where EVERY function can read them. The per-process memo (`memo.ts`) is a first level in front
 * of this; this is the level that survives a function boundary, which on Vercel is the boundary
 * between the invocation that made the pick and the one answering a viewer's `/assistant` request.
 *
 * ONE ROW PER DRAFT (`draft_room_facts`, `@research-ts/db/schema`): the invocation that lands a pick computes
 * the facts for the state it produced and writes them over the draft's row; a reader asks for the
 * facts at the sequence it holds and gets them only when the row's sequence is that one. No lock
 * and no waiting on a writer: a viewer who reads before the pick's own compute has landed simply
 * computes, which is what a miss always cost, and the write is a plain upsert that a stale writer
 * can never regress (`sequence >= excluded.sequence` keeps the newer row).
 *
 * WIRE FORM: the odds table's `played` runs are stored as arrays of player ids when a run is the
 * plain continuation it almost always is (consecutive pick numbers from `fromPick`, each pick by
 * the seat the snake order names), and as whole `PlayedPick` objects for any run that is not, so
 * the round trip is exact by construction (`facts-store.test.ts` proves both shapes).
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { draftRoomFacts } from "@/db/schema";
import { snakeTeamForPick } from "@/draft-engine";
import type { PlayedPick } from "../sim/continue";
import type { RoomOddsTable } from "../sim/room-odds";
import type { RoomFacts } from "./memo";

export interface FactsKey {
  readonly draftId: string;
  readonly sequence: number;
  /** The room's seat order, which the compact wire form derives each pick's seat from. */
  readonly draftOrder: readonly string[];
}

export interface RoomFactsStore {
  /** The facts held for exactly this draft and sequence, or null for a miss (a failure reads as a miss). */
  read(key: FactsKey): Promise<RoomFacts | null>;
  /** Remembers the facts as the draft's current ones. Never throws. */
  write(key: FactsKey, facts: RoomFacts): Promise<void>;
}

const WIRE_VERSION = 1;

type WireRun = readonly string[] | readonly PlayedPick[];

interface WireFacts {
  readonly v: number;
  readonly runs: number;
  readonly fromPick: number;
  readonly throughPick: number;
  readonly played: readonly WireRun[];
  readonly tiers: RoomFacts["tiers"];
  readonly collapses: RoomFacts["collapses"];
}

function isPlainContinuation(run: readonly PlayedPick[], fromPick: number, draftOrder: readonly string[]): boolean {
  return run.every((pick, index) => pick.pickNumber === fromPick + index && pick.teamId === snakeTeamForPick(draftOrder, pick.pickNumber));
}

export function serializeRoomFacts(facts: RoomFacts, draftOrder: readonly string[]): string {
  const { table } = facts;
  const played: readonly WireRun[] = table.played.map((run) => (isPlainContinuation(run, table.fromPick, draftOrder) ? run.map((pick) => pick.playerId) : run));
  const wire: WireFacts = { v: WIRE_VERSION, runs: table.runs, fromPick: table.fromPick, throughPick: table.throughPick, played, tiers: facts.tiers, collapses: facts.collapses };
  return JSON.stringify(wire);
}

function isWireFacts(value: unknown): value is WireFacts {
  if (typeof value !== "object" || value === null) return false;
  const wire = value as Partial<WireFacts>;
  return (
    wire.v === WIRE_VERSION &&
    typeof wire.runs === "number" &&
    typeof wire.fromPick === "number" &&
    typeof wire.throughPick === "number" &&
    Array.isArray(wire.played) &&
    typeof wire.tiers === "object" &&
    wire.tiers !== null &&
    Array.isArray(wire.collapses)
  );
}

/** `null` for anything that is not this module's own wire form (a stale version, a corrupt value). */
export function deserializeRoomFacts(text: string, draftOrder: readonly string[]): RoomFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isWireFacts(parsed)) return null;
  const { fromPick } = parsed;
  const played: readonly (readonly PlayedPick[])[] = parsed.played.map((run) =>
    run.map((pick, index): PlayedPick => {
      if (typeof pick !== "string") return pick;
      const pickNumber = fromPick + index;
      return { pickNumber, teamId: snakeTeamForPick(draftOrder, pickNumber), playerId: pick };
    }),
  );
  const table: RoomOddsTable = { runs: parsed.runs, fromPick, throughPick: parsed.throughPick, played };
  return { table, tiers: parsed.tiers, collapses: parsed.collapses };
}

/** The production store, over the draft's own row in Postgres. Every failure is logged once per streak. */
export function createDbRoomFactsStore(db: Db): RoomFactsStore {
  let erroring = false;
  const report = (operation: string, error: unknown): void => {
    if (!erroring) console.error(`[advisor] facts store ${operation} failed; computing in-process until Postgres answers again`, error);
    erroring = true;
  };
  return {
    async read(key) {
      try {
        const [row] = await db.select({ sequence: draftRoomFacts.sequence, facts: draftRoomFacts.facts }).from(draftRoomFacts).where(eq(draftRoomFacts.draftId, key.draftId));
        erroring = false;
        return row === undefined || row.sequence !== key.sequence ? null : deserializeRoomFacts(row.facts, key.draftOrder);
      } catch (error: unknown) {
        report("read", error);
        return null;
      }
    },
    async write(key, facts) {
      try {
        const text = serializeRoomFacts(facts, key.draftOrder);
        await db
          .insert(draftRoomFacts)
          .values({ draftId: key.draftId, sequence: key.sequence, facts: text })
          .onConflictDoUpdate({
            target: draftRoomFacts.draftId,
            set: { sequence: key.sequence, facts: text, computedAt: sql`now()` },
            // A stale writer (a slower compute for an older sequence) never regresses the row.
            setWhere: sql`${draftRoomFacts.sequence} <= ${key.sequence}`,
          });
        erroring = false;
      } catch (error: unknown) {
        report("write", error);
      }
    },
  };
}

export interface MemoryRoomFactsStore extends RoomFactsStore {
  /** Draft id to the wire text and sequence held: the test double's own inspectable state. */
  readonly held: Map<string, { readonly sequence: number; readonly text: string }>;
}

/** In-memory, single-process: the test double, with the identical contract and the same one-row-per-draft shape. */
export function createMemoryRoomFactsStore(): MemoryRoomFactsStore {
  const held = new Map<string, { readonly sequence: number; readonly text: string }>();
  return {
    held,
    async read(key) {
      const row = held.get(key.draftId);
      return row === undefined || row.sequence !== key.sequence ? null : deserializeRoomFacts(row.text, key.draftOrder);
    },
    async write(key, facts) {
      const row = held.get(key.draftId);
      if (row !== undefined && row.sequence > key.sequence) return;
      held.set(key.draftId, { sequence: key.sequence, text: serializeRoomFacts(facts, key.draftOrder) });
    },
  };
}
