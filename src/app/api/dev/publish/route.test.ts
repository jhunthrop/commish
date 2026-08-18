import { describe, it, expect, afterEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/realtime/publisher", () => ({
  getPublisher: vi.fn(() => ({ publish: publishSpy })),
}));

import { POST } from "./route";

const publishSpy = vi.fn(async () => "1-0");

const body = {
  leagueId: "league_dev_publish",
  type: "chat.message" as const,
  payload: { text: "hello" },
};

const post = (input: unknown = body) =>
  new Request("http://test/api/dev/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  publishSpy.mockClear();
});

/**
 * The kill-switch is the only thing making this route safe to ship: it publishes an arbitrary
 * event — `draft.timer_expire` included — into any league's stream with no authentication of
 * its own. It was also the one security guard on the branch with no test.
 */
describe("POST /api/dev/publish — the development kill-switch", () => {
  it.each(["production", "test"])("answers 404 and publishes nothing when NODE_ENV is %j", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv as "production" | "test");
    const response = await POST(post());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("is checked before the body is even parsed, so it cannot be probed with a payload", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(post({ nonsense: true }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("publishes in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { id: "1-0" } });
    expect(publishSpy).toHaveBeenCalledWith(body);
  });

  it("still validates the body in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await POST(post({ ...body, type: "not.an.event" }));
    expect(response.status).toBe(400);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
