/**
 * THE ROOM FACTS STORE (draft-room performance round, item 2): the room's facts for one log
 * sequence, held where EVERY function can read them. The per-process memo (`memo.ts`) is a first
 * level in front of this; this is the level that survives a function boundary, which on Vercel is
 * the boundary between the invocation that made the pick and the one answering a viewer's
 * `/assistant` request (Phase 1: the two never share a process, so a process-only warm could
 * never serve a viewer there, and every `/assistant` call was a cold compute).
 *
 * Keyed `advisor:facts:<draftId>:<sequence>` with a short TTL (`ADVISOR_CONFIG.facts.ttlMs`): a
 * new pick is a new key and the old one expires on its own. `roomFactsOnce` is the one
 * read-or-compute path: a hit is served; a miss computes under a short lock so two readers of the
 * same state never both simulate; a reader that finds the lock taken waits for the holder's write
 * rather than racing it, and computes itself only once the wait runs out (a holder that died
 * mid-compute must not strand every viewer). Every Redis failure degrades to "compute here" and is
 * logged once per streak, never thrown into a viewer's request.
 *
 * WIRE FORM: the odds table's `played` runs are stored as arrays of player ids when a run is the
 * plain continuation it almost always is (consecutive pick numbers from `fromPick`, each pick by
 * the seat the snake order names), and as whole `PlayedPick` objects for any run that is not, so
 * the round trip is exact by construction (`facts-store.test.ts` proves both shapes).
 */
import type Redis from "ioredis";
import { snakeTeamForPick } from "@/draft-engine";
import type { PlayedPick } from "../sim/continue";
import type { RoomOddsTable } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import type { RoomFacts } from "./memo";

export interface FactsKey {
  readonly draftId: string;
  readonly sequence: number;
  /** The room's seat order, which the compact wire form derives each pick's seat from. */
  readonly draftOrder: readonly string[];
}

export interface RoomFactsStore {
  /** The facts held for this key, or null for a miss (a Redis failure reads as a miss). */
  read(key: FactsKey): Promise<RoomFacts | null>;
  /** Remembers the facts for `ADVISOR_CONFIG.facts.ttlMs`. Never throws. */
  write(key: FactsKey, facts: RoomFacts): Promise<void>;
  /** True when this caller now holds the compute lock for the key. A Redis failure answers true:
   *  compute here rather than wait on a lock nobody can see. */
  acquire(key: FactsKey): Promise<boolean>;
  release(key: FactsKey): Promise<void>;
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

export const factsKey = (key: FactsKey): string => `advisor:facts:${key.draftId}:${key.sequence}`;
export const factsLockKey = (key: FactsKey): string => `advisor:facts-lock:${key.draftId}:${key.sequence}`;

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

/** The ioredis surface this store touches, so a test fakes three commands rather than a client. */
type FactsRedis = Pick<Redis, "get" | "set" | "del">;

/** The production store, over the shared Redis. Every failure is logged once per streak. */
export function createRedisRoomFactsStore(redis: FactsRedis): RoomFactsStore {
  let erroring = false;
  const report = (operation: string, error: unknown): void => {
    if (!erroring) console.error(`[advisor] facts store ${operation} failed; computing in-process until Redis answers again`, error);
    erroring = true;
  };
  return {
    async read(key) {
      try {
        const held = await redis.get(factsKey(key));
        erroring = false;
        return held === null ? null : deserializeRoomFacts(held, key.draftOrder);
      } catch (error: unknown) {
        report("read", error);
        return null;
      }
    },
    async write(key, facts) {
      try {
        await redis.set(factsKey(key), serializeRoomFacts(facts, key.draftOrder), "PX", ADVISOR_CONFIG.facts.ttlMs);
        erroring = false;
      } catch (error: unknown) {
        report("write", error);
      }
    },
    async acquire(key) {
      try {
        const taken = await redis.set(factsLockKey(key), "1", "PX", ADVISOR_CONFIG.facts.lockMs, "NX");
        erroring = false;
        return taken === "OK";
      } catch (error: unknown) {
        report("lock", error);
        return true;
      }
    },
    async release(key) {
      try {
        await redis.del(factsLockKey(key));
      } catch (error: unknown) {
        report("unlock", error);
      }
    },
  };
}

export interface MemoryRoomFactsStore extends RoomFactsStore {
  readonly held: Map<string, string>;
  readonly locks: Set<string>;
}

/** In-memory, single-process: the test double, with the identical contract. */
export function createMemoryRoomFactsStore(): MemoryRoomFactsStore {
  const held = new Map<string, string>();
  const locks = new Set<string>();
  return {
    held,
    locks,
    async read(key) {
      const text = held.get(factsKey(key));
      return text === undefined ? null : deserializeRoomFacts(text, key.draftOrder);
    },
    async write(key, facts) {
      held.set(factsKey(key), serializeRoomFacts(facts, key.draftOrder));
    },
    async acquire(key) {
      if (locks.has(factsLockKey(key))) return false;
      locks.add(factsLockKey(key));
      return true;
    },
    async release(key) {
      locks.delete(factsLockKey(key));
    },
  };
}

export interface RoomFactsOnceOptions {
  /** Test seams over the wait's sleep and bounds. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly waitPollMs?: number;
  readonly waitMaxMs?: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** See the module docblock: the one read-or-compute path. */
export async function roomFactsOnce(store: RoomFactsStore, key: FactsKey, compute: () => Promise<RoomFacts>, options: RoomFactsOnceOptions = {}): Promise<RoomFacts> {
  const sleep = options.sleep ?? realSleep;
  const pollMs = options.waitPollMs ?? ADVISOR_CONFIG.facts.waitPollMs;
  const maxMs = options.waitMaxMs ?? ADVISOR_CONFIG.facts.waitMaxMs;

  const held = await store.read(key);
  if (held !== null) return held;

  if (await store.acquire(key)) {
    try {
      const facts = await compute();
      await store.write(key, facts);
      return facts;
    } finally {
      await store.release(key);
    }
  }

  for (let waited = 0; waited < maxMs; waited += pollMs) {
    await sleep(pollMs);
    const written = await store.read(key);
    if (written !== null) return written;
  }
  const facts = await compute();
  await store.write(key, facts);
  return facts;
}
