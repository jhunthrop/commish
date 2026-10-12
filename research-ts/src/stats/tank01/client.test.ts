import { afterEach, describe, expect, it } from "vitest";
import { createTank01Client } from "./client";

/**
 * `tank01-stats-provider.test.ts` replaces `globalThis.fetch` with a thrower for its whole file
 * so nothing there can ever fall back to it — which is exactly right for that suite, but it also
 * means the `options.fetch ?? globalThis.fetch` default in `createTank01Client` is never
 * exercised there. This file is the one place that default is proven, using a local stub in
 * place of `globalThis.fetch` rather than a real network call.
 */
describe("createTank01Client", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("falls back to globalThis.fetch when no fetch is injected", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ statusCode: 200, body: { ok: true } }), { status: 200 });
    }) as typeof globalThis.fetch;

    const client = createTank01Client({ apiKey: "test-key" });
    const body = await client.get("/getNFLTeams");

    expect(body).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/getNFLTeams");
  });
});
