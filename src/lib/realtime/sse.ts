import { fail } from "@/lib/api/respond";
import { REALTIME_CONFIG } from "./config";
import { createRedisConnection } from "./redis";
import { subscribe } from "./subscribe";
import type { RealtimeEvent } from "./events";

const encoder = new TextEncoder();

function frame(event: RealtimeEvent): Uint8Array {
  // `id:` is the stream entry id — the browser echoes it back as Last-Event-ID on reconnect.
  return encoder.encode(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

const KEEPALIVE = encoder.encode(": keepalive\n\n");

/**
 * A frame the stream synthesizes rather than relays (`draft.resync`): no `id:` line, so the
 * browser keeps the last stream id it saw as its `Last-Event-ID` and a reconnect still resumes
 * from the stream's own position.
 */
function synthesizedFrame(event: Omit<RealtimeEvent, "id">): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

/**
 * The opening bytes: the browser's reconnect delay for the planned close (`retry:` is the SSE
 * field that sets it), then the same comment frame the keepalive sends. The `retry:` line is
 * part of the comment frame's own message, so an `EventSource` still sees no event here.
 */
const OPENING = encoder.encode(`retry: ${REALTIME_CONFIG.retryHintMs}\n: keepalive\n\n`);

/** Live-only cursor: XREAD's "everything from now on". */
const LIVE = "$";

/** Redis Stream entry ids are `<ms>-<seq>` and nothing else. */
const STREAM_ID = /^\d{1,20}-\d{1,20}$/;

/**
 * How many streams one user may hold open across this process, and the decrementing map.
 *
 * Every accepted connection takes a dedicated Redis socket (XREAD BLOCK holds it) plus a
 * keepalive timer, so without a ceiling one authenticated member of one league can exhaust the
 * Redis connection limit and the Node fd table for every league on the box. Per-process and
 * in-memory on purpose: this is a blast-radius bound on a single instance, not a distributed
 * quota — the fd table it protects is per-process too.
 */
const openPerUser = new Map<string, number>();

/**
 * The client-supplied resume cursor, or `"$"` when it cannot be trusted.
 *
 * `Last-Event-ID` is attacker-controlled text that goes straight to XREAD. A malformed value
 * makes ioredis reject and errors the stream after the headers are already sent; `0-0` replays
 * the whole retained stream (up to `streamMaxLen`) on every connection, which is cheap
 * amplification. Anything outside the catch-up window is refused for the same reason and
 * because it isn't useful: a client that far behind refetches state on reconnect anyway.
 */
export function resumeCursor(lastEventId: string | null, now: number): string {
  if (lastEventId === null || !STREAM_ID.test(lastEventId)) return LIVE;
  const millis = Number(lastEventId.split("-")[0]);
  if (millis <= 0 || millis > now || now - millis > REALTIME_CONFIG.catchUpWindowMs) return LIVE;
  return lastEventId;
}

export interface EventStreamOptions {
  /** Called with every frame this connection relays, after it is enqueued — the league route's
   *  seam for waking its draft advance loop off the stream it already reads (finding 2). */
  readonly onEvent?: (event: RealtimeEvent) => void;
  /** Test seams over `REALTIME_CONFIG.plannedCloseMs` and `keepaliveMs`. */
  readonly plannedCloseMs?: number;
  readonly keepaliveMs?: number;
  /**
   * THE LOST VOICE (review finding 3): the draft this league's stream watches, and the resync
   * marker's read for it. Read once as the stream opens (a mark older than this connection is
   * the client's own open resync's business) and on every keepalive; a newer mark relays one
   * synthesized `draft.resync` frame, so a viewer refetches within one keepalive of a pick that
   * committed but failed to publish.
   */
  readonly resync?: {
    readonly leagueId: string;
    readonly draftId: string;
    readonly check: (draftId: string) => Promise<string | null>;
  };
  /**
   * The connection's three moments, for the presence store (`presence.ts`): the opening bytes
   * have gone, a keepalive went, the socket closed. Each is awaited nowhere and may never throw
   * into the stream; `presenceLifecycle` guarantees the second half and this module the first.
   */
  readonly lifecycle?: {
    readonly onOpen: () => Promise<void>;
    readonly onKeepalive: () => Promise<void>;
    readonly onClose: () => Promise<void>;
  };
}

/**
 * The shared SSE builder both `createLeagueEventStream` and `createUserEventStream` go
 * through — one connection ceiling (`openPerUser`/`maxStreamsPerUser`), one keepalive
 * cadence, one resume rule, one Redis connection lifecycle, one planned close, regardless of
 * which stream keys the caller resolved. A notices tab is a Redis socket and an fd like any
 * other, so it correctly counts against the same per-user ceiling a league room's tabs do.
 */
function createEventStream(request: Request, userId: string, streamKeys: readonly [string, ...string[]], options: EventStreamOptions = {}): Response {
  const open = openPerUser.get(userId) ?? 0;
  if (open >= REALTIME_CONFIG.maxStreamsPerUser) {
    return fail("You have too many live connections open. Close a tab and try again.", 429);
  }
  openPerUser.set(userId, open + 1);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    const remaining = (openPerUser.get(userId) ?? 1) - 1;
    if (remaining <= 0) openPerUser.delete(userId);
    else openPerUser.set(userId, remaining);
  };

  const afterId = resumeCursor(request.headers.get("last-event-id"), Date.now());
  const [streamKey, ...extraStreamKeys] = streamKeys;

  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  // THE PLANNED CLOSE (finding 3): end the stream ourselves, cleanly, before the platform's
  // function cap kills it. The client reconnects after `retryHintMs` and resumes from its
  // Last-Event-ID, inside the catch-up window, so nothing is lost and nothing is logged.
  const plannedClose = setTimeout(() => controller.abort(), options.plannedCloseMs ?? REALTIME_CONFIG.plannedCloseMs);

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      let keepalive: ReturnType<typeof setInterval> | undefined;
      let redis: ReturnType<typeof createRedisConnection> | undefined;
      // THE OPENING BYTES, before anything that can block. An `EventSource` does not fire `open`
      // — and a fetch does not resolve its response — until the first chunk of the body arrives,
      // and this body's next write was the keepalive fifteen seconds later: `subscribe()` blocks
      // on XREAD and a quiet league has nothing to say. So every room in this product spent its
      // first fifteen seconds telling the manager the connection was "Connecting…", or
      // "Reconnecting…" if the tab had ever dropped the stream before (`league-stream.ts` latches
      // that state and replays it to the next subscriber). FOUNDER 2026-08-27, of a mock draft:
      // "why does it always show reconnecting here?" — always, because the delay is a constant,
      // and loudest in a mock because you land in a live room and start drafting inside those
      // same fifteen seconds.
      //
      // A comment frame is the right opener: the SSE wire format ignores `:` lines, so this
      // carries no event and cannot be mistaken for one — it exists only to complete the
      // response head and flip the client to open. Enqueued before `createRedisConnection()`,
      // which can itself take a moment on a cold socket.
      sink.enqueue(OPENING);
      void options.lifecycle?.onOpen();
      // The resync mark this connection has already accounted for: whatever stood as it opened.
      let lastResyncMark: string | null = null;
      const resync = options.resync;
      const relayResyncIfMarked = async (): Promise<void> => {
        if (resync === undefined) return;
        const mark = await resync.check(resync.draftId);
        if (mark === null || mark === lastResyncMark) return;
        lastResyncMark = mark;
        sink.enqueue(synthesizedFrame({ type: "draft.resync", leagueId: resync.leagueId, payload: { draftId: resync.draftId, markedAt: mark }, timestamp: mark }));
      };
      if (resync !== undefined) lastResyncMark = await resync.check(resync.draftId);
      try {
        redis = createRedisConnection("subscribe");
        keepalive = setInterval(() => {
          try {
            sink.enqueue(KEEPALIVE);
            void options.lifecycle?.onKeepalive();
            relayResyncIfMarked().catch(() => undefined);
          } catch {
            controller.abort();
          }
        }, options.keepaliveMs ?? REALTIME_CONFIG.keepaliveMs);
        for await (const event of subscribe({ redis, streamKey, extraStreamKeys, afterId, signal: controller.signal })) {
          sink.enqueue(frame(event));
          options.onEvent?.(event);
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) throw error;
      } finally {
        clearInterval(keepalive);
        clearTimeout(plannedClose);
        redis?.disconnect();
        release();
        void options.lifecycle?.onClose();
        try {
          sink.close();
        } catch {
          // already closed by the client disconnecting
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

/**
 * Builds a Server-Sent Events response for a league's stream. Used by the SSE route
 * handler; native clients consume the identical wire format over URLSession/OkHttp.
 *
 * Resume: reads the standard Last-Event-ID header (sent automatically by EventSource on
 * reconnect) and replays everything after it. A fresh connection starts at "$" (live only).
 *
 * ALSO CARRIES THE CALLER'S OWN USER STREAM (finding 3): the notice frames that used to need a
 * second connection per tab ride this one, on the same socket, for the same caller — never a
 * leaguemate's, because the user key is the signed-in caller's own.
 */
export function createLeagueEventStream(request: Request, leagueId: string, userId: string, options?: EventStreamOptions): Response {
  return createEventStream(request, userId, [REALTIME_CONFIG.leagueStreamKey(leagueId), REALTIME_CONFIG.userStreamKey(userId)], options);
}

/**
 * Builds a Server-Sent Events response for ONE USER's own stream — the second key format
 * (`REALTIME_CONFIG.userStreamKey`), used today for `notice.created`. Same resume rule, same
 * connection ceiling as `createLeagueEventStream`: `GET /api/notices/stream` calls this with
 * the caller's own id, and there is no route anywhere that takes a user id from a request —
 * see `src/app/api/notices/stream/route.ts`. A tab with no league stream open holds this one.
 */
export function createUserEventStream(request: Request, userId: string, options?: EventStreamOptions): Response {
  return createEventStream(request, userId, [REALTIME_CONFIG.userStreamKey(userId)], options);
}
