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

/**
 * The streaming reader is the path play-by-play arrives on, and the only path in the engine where
 * the data is too large to eyeball. These pin the three things that would corrupt a season's worth
 * of derived team metrics without anything else in the suite noticing: a record split across a
 * chunk boundary, a column that has moved, and a ragged row.
 */
describe("createNflverseClient.streamCsv", () => {
  /** A body delivered in the awkward pieces a real socket delivers, not as one string. */
  function chunkedResponse(chunks: readonly string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/csv" } });
  }

  function streamingClient(chunks: readonly string[]) {
    return clientWith((async () => chunkedResponse(chunks)) as typeof globalThis.fetch);
  }

  it("reassembles records split across chunk boundaries", async () => {
    const client = streamingClient(["week,team,ya", "rds\n1,CLE,", "88\n2,BU", "F,120\n"]);
    const rows: Record<string, string>[] = [];

    const count = await client.streamCsv("pbp", "play_by_play_2024.csv", ["team", "yards"], (row) => rows.push({ ...row }));

    expect(count).toBe(2);
    expect(rows).toEqual([
      { team: "CLE", yards: "88" },
      { team: "BUF", yards: "120" },
    ]);
  });

  it("hands the caller only the columns it named", async () => {
    const client = streamingClient(["a,b,c\n1,2,3\n"]);
    const rows: Record<string, string>[] = [];
    await client.streamCsv("pbp", "play_by_play_2024.csv", ["c"], (row) => rows.push({ ...row }));
    expect(rows).toEqual([{ c: "3" }]);
  });

  it("keeps a quoted field containing a comma and a newline intact across chunks", async () => {
    const client = streamingClient(['a,b\n"one,', 'two\nthree",4\n']);
    const rows: Record<string, string>[] = [];
    await client.streamCsv("pbp", "play_by_play_2024.csv", ["a", "b"], (row) => rows.push({ ...row }));
    expect(rows).toEqual([{ a: "one,two\nthree", b: "4" }]);
  });

  it("throws when a named column is absent, rather than handing back an undefined a rate would read as zero", async () => {
    const client = streamingClient(["a,b\n1,2\n"]);
    await expect(
      client.streamCsv("pbp", "play_by_play_2024.csv", ["rushing_yards"], () => undefined),
    ).rejects.toThrow(/no column "rushing_yards"/);
  });

  it("throws on a ragged row — a truncated download is not a short row", async () => {
    const client = streamingClient(["a,b\n1,2\n3\n"]);
    await expect(client.streamCsv("pbp", "play_by_play_2024.csv", ["a"], () => undefined)).rejects.toThrow(/truncated/);
  });

  it("throws on an empty body rather than reporting a season of no plays", async () => {
    const client = streamingClient([""]);
    await expect(client.streamCsv("pbp", "play_by_play_2024.csv", ["a"], () => undefined)).rejects.toThrow(/empty body/);
  });

  it("decompresses a .gz asset, because nflverse publishes some releases only that way", async () => {
    const { gzipSync } = await import("node:zlib");
    const gzipped = gzipSync(Buffer.from("player,avg_time_to_throw\nMahomes,2.81\n"));
    const client = clientWith((async () =>
      new Response(new Uint8Array(gzipped), { status: 200 })) as typeof globalThis.fetch);
    const rows: Record<string, string>[] = [];

    await client.streamCsv("nextgen_stats", "ngs_2024_passing.csv.gz", ["avg_time_to_throw"], (row) => rows.push({ ...row }));

    expect(rows).toEqual([{ avg_time_to_throw: "2.81" }]);
  });
});
