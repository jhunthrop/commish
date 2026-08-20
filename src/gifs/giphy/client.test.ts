import { afterEach, describe, expect, it } from "vitest";
import { createGiphyClient } from "./client";

/**
 * `giphy-gif-provider.test.ts` replaces `globalThis.fetch` with a thrower for its whole file so
 * nothing there can ever fall back to it. This file is the one place the `options.fetch ??
 * globalThis.fetch` default is proven, mirroring `src/stats/tank01/client.test.ts`.
 */
describe("createGiphyClient", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("falls back to globalThis.fetch when no fetch is injected", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return new Response(JSON.stringify({ data: [], pagination: {}, meta: { status: 200, msg: "OK" } }), { status: 200 });
    }) as typeof globalThis.fetch;

    const client = createGiphyClient({ apiKey: "test-key" });
    const data = await client.search("touchdown", 5);

    expect(data).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("q=touchdown");
  });
});
