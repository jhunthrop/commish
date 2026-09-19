import { describe, expect, it, vi } from "vitest";
import { JOBS_CONFIG } from "./config";
import { createSelfWake, JOB_RUN_PATH, PROTECTION_BYPASS_HEADER } from "./self-wake";

const NOW = Date.parse("2026-09-19T00:00:00.000Z");

function harness(env: Record<string, string | undefined>, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  const deferred: (() => Promise<void>)[] = [];
  const selfWake = createSelfWake({ env, fetch: fetchFn, now: () => NOW, defer: (work) => deferred.push(work) });
  const flush = async (): Promise<void> => {
    for (const work of deferred.splice(0)) await work();
  };
  return { ...selfWake, calls, deferred, flush };
}

const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

describe("the self-wake", () => {
  it("posts the job and its due instant to its own run route, bearer-authenticated, after the response", async () => {
    const { wake, calls, deferred, flush } = harness({ CRON_SECRET: "s3cret", JOBS_SELF_URL: "http://localhost:3151" });
    wake(41, NOW + 700, "draft_a");
    expect(calls).toEqual([]);
    expect(deferred).toHaveLength(1);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`http://localhost:3151${JOB_RUN_PATH}`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(headersOf(calls[0]!.init).authorization).toBe("Bearer s3cret");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ jobId: 41, dueAt: new Date(NOW + 700).toISOString() });
  });

  it("covers any due time inside the chain ceiling (a 90 s and a 180 s clock included) and leaves only a longer one to the cron", () => {
    const { wake, deferred } = harness({ CRON_SECRET: "s3cret" });
    wake(1, NOW + 90_000);
    wake(2, NOW + 180_000);
    wake(3, NOW + JOBS_CONFIG.selfWakeChainMaxMs);
    expect(deferred).toHaveLength(3);
    wake(4, NOW + JOBS_CONFIG.selfWakeChainMaxMs + 1);
    expect(deferred).toHaveLength(3);
    expect(JOBS_CONFIG.selfWakeChainMaxMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it("wakeNow sends at once and awaits the answer: what a sleeper re-arms itself with", async () => {
    const { wakeNow, calls, deferred } = harness({ CRON_SECRET: "s3cret" });
    await wakeNow(9, NOW + 30_000, "draft_b");
    expect(deferred).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ jobId: 9, dueAt: new Date(NOW + 30_000).toISOString() });
  });

  it("carries the deployment-protection bypass header only when the secret is set (finding 4)", async () => {
    const withSecret = harness({ CRON_SECRET: "s3cret", VERCEL_AUTOMATION_BYPASS_SECRET: "bypass-me" });
    await withSecret.wakeNow(1, NOW);
    expect(headersOf(withSecret.calls[0]!.init)[PROTECTION_BYPASS_HEADER]).toBe("bypass-me");
    const without = harness({ CRON_SECRET: "s3cret" });
    await without.wakeNow(1, NOW);
    expect(PROTECTION_BYPASS_HEADER in headersOf(without.calls[0]!.init)).toBe(false);
    const empty = harness({ CRON_SECRET: "s3cret", VERCEL_AUTOMATION_BYPASS_SECRET: "" });
    await empty.wakeNow(1, NOW);
    expect(PROTECTION_BYPASS_HEADER in headersOf(empty.calls[0]!.init)).toBe(false);
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

  it("a refused wake is logged once per room, never thrown, and never once per pick (finding 4)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { wakeNow } = harness({ CRON_SECRET: "s3cret" }, 401);
    await wakeNow(7, NOW, "draft_a");
    await wakeNow(8, NOW, "draft_a");
    await wakeNow(9, NOW, "draft_b");
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("self-wake refused"), { room: "draft_a", jobId: 7, status: 401 });
    error.mockRestore();
  });
});
