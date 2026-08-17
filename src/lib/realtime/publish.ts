import type Redis from "ioredis";
import type { Clock } from "@/domain/timing";
import { REALTIME_CONFIG } from "./config";
import type { RealtimeEventType } from "./events";

interface PublishInput {
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}

interface PublisherDeps {
  readonly redis: Redis;
  readonly clock: Clock;
  /** Optional sink for publish failures — wired to structured logging in Phase 2. */
  readonly onError?: (error: unknown, input: PublishInput) => void;
}

/**
 * The only way any feature writes to a league stream.
 *
 * Publishing is best-effort by contract: the caller has already committed the
 * underlying write to Postgres, which is authoritative. A Redis failure must
 * therefore never surface as a rejection of that write — it returns null and
 * clients fall back to a full-state refetch.
 */
export function createPublisher({ redis, clock, onError }: PublisherDeps) {
  async function publish(input: PublishInput): Promise<string | null> {
    try {
      const id = await redis.xadd(
        REALTIME_CONFIG.leagueStreamKey(input.leagueId),
        "MAXLEN",
        "~",
        REALTIME_CONFIG.streamMaxLen,
        "*",
        "type",
        input.type,
        "leagueId",
        input.leagueId,
        "payload",
        JSON.stringify(input.payload ?? null),
        "timestamp",
        clock.now(),
      );
      return id;
    } catch (error: unknown) {
      onError?.(error, input);
      return null;
    }
  }

  function close(): void {
    redis.disconnect();
  }

  return { publish, close };
}

export type Publisher = ReturnType<typeof createPublisher>;
