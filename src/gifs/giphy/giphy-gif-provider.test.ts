import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeGifProviderContract } from "../test-support";
import { GiphyError } from "./client";
import { createFixtureFetch, readManifest } from "./fixtures";
import { createGiphyGifProvider } from "./giphy-gif-provider";

/**
 * NOTHING in this file may reach the network. Every test injects `createFixtureFetch()`, and
 * this guard (mirroring `src/stats/tank01/tank01-stats-provider.test.ts`) makes a code path that
 * fell back to the global `fetch` fail by name instead of quietly making a real request — even
 * with a `GIPHY_API_KEY` present in the environment.
 */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("A Giphy test tried to use the real fetch. Every test must inject createFixtureFetch().");
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const provider = () => Promise.resolve(createGiphyGifProvider({ apiKey: "test-key", fetch: createFixtureFetch() }));

describeGifProviderContract("GiphyGifProvider", provider);

describe("GiphyGifProvider", () => {
  it("answers an empty (or whitespace-only) query without making a request at all", async () => {
    let calls = 0;
    const counting: typeof globalThis.fetch = (...args) => {
      calls += 1;
      return createFixtureFetch()(...args);
    };
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: counting });
    expect(await subject.search("   ", 5)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("always sends the configured rating ceiling on the request", async () => {
    const requestedUrls: string[] = [];
    const recording: typeof globalThis.fetch = async (input) => {
      requestedUrls.push(typeof input === "string" ? input : input.toString());
      return createFixtureFetch()(input);
    };
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: recording });
    await subject.search("touchdown", 5);
    expect(requestedUrls.some((url) => url.includes("rating=pg-13"))).toBe(true);
  });

  it("turns a 401 into a typed unauthorized failure that names the env var", async () => {
    const unauthorized: typeof globalThis.fetch = async () => new Response(JSON.stringify({ message: "Invalid API key." }), { status: 401 });
    const subject = createGiphyGifProvider({ apiKey: "wrong", fetch: unauthorized });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ name: GiphyError.name, kind: "unauthorized" });
    await expect(subject.search("touchdown", 5)).rejects.toThrow("GIPHY_API_KEY");
  });

  it("turns a 429 into a typed rate_limited failure", async () => {
    const limited: typeof globalThis.fetch = async () => new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: limited });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("turns any other non-ok HTTP status into a typed upstream failure", async () => {
    const serverError: typeof globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: serverError });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "upstream" });
  });

  it("turns a non-JSON body into a typed malformed failure", async () => {
    const notJson: typeof globalThis.fetch = async () => new Response("<html>not json</html>", { status: 200 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: notJson });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("turns a 200 with no data key into a typed malformed failure", async () => {
    const noData: typeof globalThis.fetch = async () => new Response(JSON.stringify({ meta: { status: 200 } }), { status: 200 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: noData });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("succeeds on a 200 response that carries no meta object at all", async () => {
    // Giphy's documented shape always includes meta, but this client's own read of it
    // (`typeof envelope.meta === "object"`) is defensive rather than assumed — a response
    // missing meta entirely must still be read as a plain success, not fail to parse it.
    const noMeta: typeof globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: noMeta });
    await expect(subject.search("touchdown", 5)).resolves.toEqual([]);
  });

  it("treats an HTTP 200 carrying a meta.status error as a failure, not as an empty search", async () => {
    // The single most dangerous upstream behavior: a refused request can answer 200 with an
    // empty data array and the real failure code buried in meta.status, which a status-only
    // check would map to zero results and nobody would notice.
    const refused: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [], pagination: {}, meta: { status: 403, msg: "Invalid authentication credentials" } }), {
        status: 200,
      });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: refused });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ name: GiphyError.name, kind: "unauthorized" });
  });

  it("treats a meta.status of 429 the same as an HTTP 429", async () => {
    const refused: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [], pagination: {}, meta: { status: 429, msg: "" } }), { status: 200 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: refused });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("treats any other meta.status error as an upstream failure, defaulting the message when msg is blank", async () => {
    const refused: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: [], pagination: {}, meta: { status: 500, msg: "" } }), { status: 200 });
    const subject = createGiphyGifProvider({ apiKey: "test-key", fetch: refused });
    await expect(subject.search("touchdown", 5)).rejects.toMatchObject({ kind: "upstream" });
    await expect(subject.search("touchdown", 5)).rejects.toThrow("unknown error");
  });
});

describe("the fixture manifest", () => {
  it("declares an honest provenance", () => {
    const manifest = readManifest();
    expect(["authored-from-published-response-shapes", "recorded-from-live-api"]).toContain(manifest.provenance);
    if (manifest.provenance === "recorded-from-live-api") expect(manifest.recordedAt).not.toBeNull();
  });

  it("names a file for every fixture and a fixture for every file", async () => {
    const { readdirSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
    const onDisk = readdirSync(dir).filter((name) => name.endsWith(".json") && name !== "manifest.json");
    const declared = readManifest().entries.map((entry) => entry.file);
    expect([...onDisk].sort()).toEqual([...declared].sort());
  });
});
