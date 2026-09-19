import { describe, expect, it, vi } from "vitest";
import { JOBS_CONFIG } from "./config";
import { createSelfWake, JOB_RUN_PATH } from "./self-wake";

const NOW = Date.parse("2026-09-19T00:00:00.000Z");

function harness(env: Record<string, string | undefined>, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  const deferred: (() => Promise<void>)[] = [];
  const { wake } = createSelfWake({ env, fetch: fetchFn, now: () => NOW, defer: (work) => deferred.push(work) });
  const flush = async (): Promise<void> => {
    for (const work of deferred.splice(0)) await work();
  };
  return { wake, calls, deferred, flush };
}

describe("the self-wake", () => {
  it("posts the job and its due instant to its own run route, bearer-authenticated, after the response", async () => {
    const { wake, calls, deferred, flush } = harness({ CRON_SECRET: "s3cret", JOBS_SELF_URL: "http://localhost:3151" });
    wake(41, NOW + 700);
    expect(calls).toEqual([]);
    expect(deferred).toHaveLength(1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`http://localhost:3151${JOB_RUN_PATH}`);
    expect(calls[0]!.init.method).toBe("POST");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer s3cret");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ jobId: 41, dueAt: new Date(NOW + 700).toISOString() });
  });

  it("leaves a job due beyond the window to the cron", () => {
    const { wake, deferred } = harness({ CRON_SECRET: "s3cret" });
    wake(1, NOW + JOBS_CONFIG.selfWakeWindowMs + 1);
    expect(deferred).toEqual([]);
    wake(2, NOW + JOBS_CONFIG.selfWakeWindowMs);
    expect(deferred).toHaveLength(1);
  });

  it("without a secret, warns once and wakes nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { wake, deferred } = harness({});
    wake(1, NOW);
    wake(2, NOW);
    expect(deferred).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("a refused wake is logged, never thrown", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { wake, flush } = harness({ CRON_SECRET: "s3cret" }, 401);
    wake(7, NOW);
    await flush();
    expect(error).toHaveBeenCalledWith("[jobs] self-wake refused", { jobId: 7, status: 401 });
    error.mockRestore();
  });
});
