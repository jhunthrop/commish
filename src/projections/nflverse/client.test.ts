import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNflverseClient, NflverseError } from "./client";
import { createFixtureFetch } from "./fixtures";

/**
 * Replaces the global `fetch` with a thrower for every test in this file — the same guard
 * `src/stats/tank01`'s suites use. A code path that fell back to the real `fetch` would otherwise
 * quietly pull megabytes off GitHub during a test run; here it fails by name instead.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("A test reached the network. Every nflverse client must be given an injected fetch.");
  });
  return () => {
    vi.unstubAllGlobals();
  };
});

function clientWith(doFetch: typeof globalThis.fetch) {
  return createNflverseClient({ fetch: doFetch });
}

function csvResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/csv" } });
}

describe("createNflverseClient", () => {
  it("requests the release asset URL nflverse publishes at", async () => {
    const seen: string[] = [];
    const client = clientWith((async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return csvResponse("a\n1\n");
    }) as typeof globalThis.fetch);

    await client.getCsv("snap_counts", "snap_counts_2024.csv");

    expect(seen).toEqual([
      "https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2024.csv",
    ]);
  });

  it("parses the body into header-keyed rows", async () => {
    const client = clientWith((async () => csvResponse("season,week\n2024,1\n")) as typeof globalThis.fetch);
    await expect(client.getCsv("snap_counts", "x.csv")).resolves.toEqual([{ season: "2024", week: "1" }]);
  });

  it("classifies a 404 as not_found — the season has not been released yet, not a broken build", async () => {
    const client = clientWith((async () => csvResponse("Not Found", 404)) as typeof globalThis.fetch);
    await expect(client.getCsv("snap_counts", "snap_counts_2099.csv")).rejects.toMatchObject({
      name: "NflverseError",
      kind: "not_found",
    });
  });

  it("classifies any other bad status as upstream", async () => {
    const client = clientWith((async () => csvResponse("boom", 503)) as typeof globalThis.fetch);
    await expect(client.getCsv("snap_counts", "x.csv")).rejects.toMatchObject({ kind: "upstream" });
  });

  it("classifies an unparseable body as malformed rather than letting the CSV error escape untyped", async () => {
    const client = clientWith((async () => csvResponse("a,b,c\n1,2\n")) as typeof globalThis.fetch);
    const failure = await client.getCsv("snap_counts", "x.csv").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NflverseError);
    expect(failure).toMatchObject({ kind: "malformed" });
  });

  it("names the asset on every failure, so an operator knows which file to look at", async () => {
    const client = clientWith((async () => csvResponse("", 500)) as typeof globalThis.fetch);
    await expect(client.getCsv("snap_counts", "snap_counts_2024.csv")).rejects.toMatchObject({
      asset: "snap_counts/snap_counts_2024.csv",
    });
  });

  it("refuses an empty body — a zero-byte release is a failed build upstream, not an empty week", async () => {
    const client = clientWith((async () => csvResponse("")) as typeof globalThis.fetch);
    await expect(client.getCsv("snap_counts", "x.csv")).rejects.toMatchObject({ kind: "malformed" });
  });
});

describe("createFixtureFetch", () => {
  it("serves the committed nflverse fixtures", async () => {
    const client = clientWith(createFixtureFetch());
    const rows = await client.getCsv("snap_counts", "snap_counts_2024_buf_w1-3.csv");
    expect(rows.length).toBeGreaterThan(100);
    expect(rows[0]).toMatchObject({ season: "2024", team: "BUF", week: "1" });
  });

  it("throws by name for an unrecorded asset instead of going to the network", async () => {
    const client = clientWith(createFixtureFetch());
    await expect(client.getCsv("snap_counts", "snap_counts_1999.csv")).rejects.toThrow(/No nflverse fixture/);
  });
});
