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
 * Builds a Server-Sent Events response for a league's stream. Used by the SSE route
 * handler; native clients consume the identical wire format over URLSession/OkHttp.
 *
 * Resume: reads the standard Last-Event-ID header (sent automatically by EventSource on
 * reconnect) and replays everything after it. A fresh connection starts at "$" (live only).
 */
export function createLeagueEventStream(request: Request, leagueId: string): Response {
  const lastEventId = request.headers.get("last-event-id");
  const afterId = lastEventId !== null && lastEventId.length > 0 ? lastEventId : "$";

  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const redis = createRedisConnection();
      const keepalive = setInterval(() => {
        try {
          sink.enqueue(KEEPALIVE);
        } catch {
          controller.abort();
        }
      }, REALTIME_CONFIG.keepaliveMs);
      try {
        for await (const event of subscribe({ redis, leagueId, afterId, signal: controller.signal })) {
          sink.enqueue(frame(event));
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) throw error;
      } finally {
        clearInterval(keepalive);
        redis.disconnect();
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
