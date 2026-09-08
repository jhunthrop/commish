import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { REALTIME_CONFIG } from "./config";
import { createPublisher } from "./publish";
import { createRedisConnection } from "./redis";
import { createLeagueEventStream, createUserEventStream, resumeCursor } from "./sse";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");

describe("resumeCursor — Last-Event-ID is attacker-controlled text on its way to XREAD", () => {
  it("passes a well-formed, recent stream id through", () => {
    const id = `${NOW - 1_000}-0`;
    expect(resumeCursor(id, NOW)).toBe(id);
  });

  it("falls back to live-only when the header is absent", () => {
    expect(resumeCursor(null, NOW)).toBe("$");
  });

  it.each([
    ["", "empty"],
    ["not-an-id", "non-numeric"],
    ["123", "no sequence part"],
    ["123-", "empty sequence part"],
    ["1-2-3", "three parts"],
    ["$", "a cursor keyword, not an id"],
    [" 1755000000000-0", "leading whitespace"],
    ["1755000000000-0\r\nid: 0-0", "a header-injection attempt"],
  ])("falls back to live-only for %j (%s)", (header) => {
    expect(resumeCursor(header, NOW)).toBe("$");
  });

  it("refuses 0-0, which would replay the whole retained stream on every connection", () => {
    expect(resumeCursor("0-0", NOW)).toBe("$");
  });

  it("refuses a cursor from the future", () => {
    expect(resumeCursor(`${NOW + 1_000}-0`, NOW)).toBe("$");
  });

  it("refuses a cursor older than the catch-up window, and accepts one just inside it", () => {
    expect(resumeCursor(`${NOW - REALTIME_CONFIG.catchUpWindowMs - 1}-0`, NOW)).toBe("$");
    expect(resumeCursor(`${NOW - REALTIME_CONFIG.catchUpWindowMs}-5`, NOW)).toBe(`${NOW - REALTIME_CONFIG.catchUpWindowMs}-5`);
  });
});

/**
 * FOUNDER 2026-08-27, looking at a live mock draft: "why does it always show reconnecting here?"
 *
 * ALWAYS, because the delay was a constant. An `EventSource` fires `open` only once the first
 * chunk of the response BODY arrives, and this body's first write used to be the keepalive —
 * `REALTIME_CONFIG.keepaliveMs` later — because `subscribe()` blocks on XREAD and a quiet league
 * has nothing to say. Every room in the product therefore opened into fifteen seconds of
 * "Connecting…", or "Reconnecting…" on any tab that had dropped the stream once before
 * (`league-stream.ts` latches that state and replays it to the next subscriber).
 *
 * The regression this guards is a silent one: the stream still WORKS without the opening frame,
 * it just lies to the manager for fifteen seconds first, which no other test in this file could
 * see.
 */
describe("createLeagueEventStream — the opening frame", () => {
  const controllers: AbortController[] = [];

  beforeEach(() => {
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.unstubAllEnvs();
  });

  it("writes a comment frame immediately, without waiting out the keepalive interval", async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const response = createLeagueEventStream(
      new Request("http://localhost/x", { signal: controller.signal }),
      "league_sse_open_test",
      "user_sse_open",
    );

    const reader = response.body!.getReader();
    // Deliberately far below `keepaliveMs`: passing this by waiting for the keepalive is exactly
    // the bug, so the budget has to be too small for that to be possible.
    const first = await Promise.race([
      reader.read().then((r) => new TextDecoder().decode(r.value)),
      new Promise<string>((resolve) => setTimeout(() => resolve("TIMED OUT"), 1_000)),
    ]);

    expect(first).toBe(": keepalive\n\n");
    expect(REALTIME_CONFIG.keepaliveMs).toBeGreaterThan(1_000);
    await reader.cancel();
  });
});

describe("createLeagueEventStream — onEvent (the advance loop's wake seam, finding 2)", () => {
  const controllers: AbortController[] = [];

  beforeEach(() => {
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.unstubAllEnvs();
  });

  it("hands every relayed frame to onEvent after it is written to the client", async () => {
    const leagueId = `league_sse_onevent_${Date.now()}`;
    const controller = new AbortController();
    controllers.push(controller);
    const seen: string[] = [];
    // A recent resume cursor rather than "$": the opening comment frame is written BEFORE the
    // XREAD is armed, so a live-only cursor could miss a frame published in that gap. Resuming
    // from a second ago replays whatever lands after it, whenever the read is issued.
    const headers = { "last-event-id": `${Date.now() - 1_000}-0` };
    const response = createLeagueEventStream(new Request("http://localhost/x", { signal: controller.signal, headers }), leagueId, "user_sse_onevent", {
      onEvent: (event) => {
        seen.push(`${event.type}:${JSON.stringify(event.payload)}`);
      },
    });
    const reader = response.body!.getReader();
    await reader.read(); // the opening comment frame

    const redis = createRedisConnection();
    try {
      const publisher = createPublisher({ redis, clock: { now: () => "2026-09-08T12:00:00.000Z" } });
      await publisher.publish({ leagueId, type: "draft.pick", payload: { clock: { sequence: 3 } } });
      const frame = new TextDecoder().decode((await reader.read()).value);
      expect(frame).toContain("event: draft.pick");
      expect(seen).toEqual(['draft.pick:{"clock":{"sequence":3}}']);
    } finally {
      await redis.del(REALTIME_CONFIG.leagueStreamKey(leagueId));
      redis.disconnect();
      await reader.cancel();
    }
  });
});

describe("createLeagueEventStream — per-user connection ceiling", () => {
  const controllers: AbortController[] = [];

  function open(userId: string): Response {
    const controller = new AbortController();
    controllers.push(controller);
    return createLeagueEventStream(new Request("http://localhost/x", { signal: controller.signal }), "league_sse_test", userId);
  }

  // A real (local) Redis, like `realtime.test.ts`: an accepted stream opens a connection in
  // `start()`, and a connection that cannot be opened releases its slot immediately — which
  // would make the ceiling untestable and, worse, untested.
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.length = 0;
    // Let the aborted subscribe loops run their `finally` (disconnect + release) before the
    // next test counts slots.
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.unstubAllEnvs();
  });

  it("accepts up to the ceiling and refuses the next one with a 429", async () => {
    const userId = "user_sse_cap";
    for (let i = 0; i < REALTIME_CONFIG.maxStreamsPerUser; i++) {
      expect(open(userId).headers.get("content-type")).toBe("text/event-stream");
    }
    const refused = open(userId);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ ok: false, error: "You have too many live connections open. Close a tab and try again." });
  });

  it("counts per user, so one heavy client cannot lock anybody else out", async () => {
    const heavy = "user_sse_heavy";
    for (let i = 0; i < REALTIME_CONFIG.maxStreamsPerUser; i++) open(heavy);
    expect(open(heavy).status).toBe(429);
    expect(open("user_sse_light").headers.get("content-type")).toBe("text/event-stream");
  });

  it("releases a slot when a connection closes", async () => {
    const userId = "user_sse_release";
    const first = open(userId);
    expect(first.headers.get("content-type")).toBe("text/event-stream");
    for (let i = 1; i < REALTIME_CONFIG.maxStreamsPerUser; i++) open(userId);
    expect(open(userId).status).toBe(429);

    controllers[0]!.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(open(userId).headers.get("content-type")).toBe("text/event-stream");
  });
});

describe("createUserEventStream — shares the same connection ceiling as the league stream", () => {
  const controllers: AbortController[] = [];

  function openLeague(userId: string): Response {
    const controller = new AbortController();
    controllers.push(controller);
    return createLeagueEventStream(new Request("http://localhost/x", { signal: controller.signal }), "league_sse_user_test", userId);
  }

  function openUser(userId: string): Response {
    const controller = new AbortController();
    controllers.push(controller);
    return createUserEventStream(new Request("http://localhost/notices/stream", { signal: controller.signal }), userId);
  }

  beforeEach(() => {
    vi.stubEnv("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");
  });

  afterEach(async () => {
    for (const controller of controllers) controller.abort();
    controllers.length = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.unstubAllEnvs();
  });

  it("opens a live stream for the caller's own user id", async () => {
    const response = openUser("user_sse_notices");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
  });

  it("counts a notices tab against the SAME per-user ceiling a league room's tabs use", async () => {
    const userId = "user_sse_mixed";
    openUser(userId);
    for (let i = 1; i < REALTIME_CONFIG.maxStreamsPerUser; i++) openLeague(userId);
    // One notices tab plus (ceiling - 1) league tabs exactly fills the shared ceiling.
    const refused = openUser(userId);
    expect(refused.status).toBe(429);
  });
});

/**
 * MEDIUM-4. The cap is a number nobody re-derived when the arithmetic under it changed: a league
 * tab used to cost one connection and now costs two, because `NoticeInbox` mounts in `TopBar`
 * on every signed-in page and opens its own per-user stream (correctly sharing this same
 * ceiling). At 8, that silently became a four-tab budget with no headroom at all. Pinned here so
 * a plan that adds a third stream type has to move the number and say why, rather than halving
 * everybody's tab budget by accident.
 */
describe("the connection cap and the per-tab cost are one arithmetic", () => {
  it("is exactly four league tabs plus a reconnect's worth of headroom", () => {
    // 4 x 2 = 8 for the honest case (a room, a TV board, a spare tab, one more), + 2 for the
    // connection a network blip left behind and the server has not reaped yet.
    expect(REALTIME_CONFIG.maxStreamsPerUser).toBe(4 * REALTIME_CONFIG.streamsPerLeagueTab + 2);
    // And the budget really is four tabs, not the two the old 8 had quietly become.
    expect(Math.floor(REALTIME_CONFIG.maxStreamsPerUser / REALTIME_CONFIG.streamsPerLeagueTab)).toBeGreaterThanOrEqual(4);
  });

  it("counts a league page as exactly the league stream plus the header's notice stream", () => {
    // If a third mounted stream type appears, this is the assertion that has to be edited, and
    // editing it is the moment `maxStreamsPerUser` gets reconsidered.
    expect(REALTIME_CONFIG.streamsPerLeagueTab).toBe(2);
  });
});
