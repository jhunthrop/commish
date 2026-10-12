import type Redis from "ioredis";
import type { Clock } from "@research-ts/domain/timing";
import { REALTIME_CONFIG } from "./config";
import type { RealtimeEventType } from "./events";

interface PublishInput {
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}

/**
 * The user-targeted counterpart of `PublishInput`. `leagueId` still rides along — the notice
 * IS about something that happened in this league — but it only ever addresses the stream key
 * `REALTIME_CONFIG.userStreamKey(userId)` computes, never the league broadcast.
 */
interface PublishToUserInput {
  readonly userId: string;
  readonly leagueId: string;
  readonly type: RealtimeEventType;
  readonly payload: unknown;
}

/**
 * The publish capability a feature is handed. Declared here, beside the only implementation,
 * so the draft service and the chat service inject the SAME contract rather than two
 * structurally-identical copies that can drift.
 */
export type PublishFn = (input: PublishInput) => Promise<string | null>;

/** The per-user counterpart of `PublishFn` — see `PublishToUserInput`. */
export type PublishToUserFn = (input: PublishToUserInput) => Promise<string | null>;

interface PublisherDeps {
  readonly redis: Redis;
  readonly clock: Clock;
  /** Optional sink for publish failures — wired to structured logging in Phase 2. */
  readonly onError?: (error: unknown, input: PublishInput | PublishToUserInput) => void;
}

/**
 * The only way any feature writes to a league stream or a user stream.
 *
 * Publishing is best-effort by contract: the caller has already committed the
 * underlying write to Postgres, which is authoritative. A Redis failure must
 * therefore never surface as a rejection of that write — it returns null and
 * clients fall back to a full-state refetch.
 */
export function createPublisher({ redis, clock, onError }: PublisherDeps) {
  /**
   * The one XADD every publish — league or user — funnels through, so the MAXLEN policy, the
   * field layout and the error contract cannot drift between `publish` and `publishToUser`.
   */
  async function append(key: string, input: PublishInput | PublishToUserInput): Promise<string | null> {
    try {
      const id = await redis.xadd(
        key,
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

  function publish(input: PublishInput): Promise<string | null> {
    return append(REALTIME_CONFIG.leagueStreamKey(input.leagueId), input);
  }

  function publishToUser(input: PublishToUserInput): Promise<string | null> {
    return append(REALTIME_CONFIG.userStreamKey(input.userId), input);
  }

  function close(): void {
    redis.disconnect();
  }

  return { publish, publishToUser, close };
}

export type Publisher = ReturnType<typeof createPublisher>;
