import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStatsProviderContract } from "../test-support";
import { Tank01Error } from "./client";
import { TANK01_CONFIG } from "./config";
import { createFixtureFetch, readManifest } from "./fixtures";
import { createTank01StatsProvider } from "./tank01-stats-provider";

/**
 * NOTHING in this file may reach the network. Every test injects `createFixtureFetch()`, and
 * this guard makes a code path that fell back to the global `fetch` fail by name instead of
 * quietly making a real, billable request from a test run.
 */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("A Tank01 test tried to use the real fetch. Every test must inject createFixtureFetch().");
  }) as typeof globalThis.fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const provider = () => createTank01StatsProvider({ apiKey: "test-key", fetch: createFixtureFetch(), season: 2026 });

describeStatsProviderContract("Tank01StatsProvider", provider);

describe("Tank01StatsProvider", () => {
  it("lists a DEF player for every NFL team", async () => {
    const players = await provider().listPlayers();
    const defenses = players.filter((player) => player.position === "DEF");
    expect(defenses).toHaveLength(32);
    expect(defenses.every((player) => player.id.startsWith(TANK01_CONFIG.defensePlayerIdPrefix))).toBe(true);
  });

  it("reports negative rushing yardage from the committed fixture rather than clamping it to zero", async () => {
    // Player 10008 in boxscore-20260913_CAR@WSH.json carries "rushYds": "-4" — real NFL data.
    const lines = await provider().getWeeklyStatLines(1);
    const line = lines.find((l) => l.playerId === "10008");
    expect(line?.rushingYards).toBe(-4);
  });

  it("does not report a stat line for an unlisted (unscored-position) player in the fixture", async () => {
    // Player 10024 (LB) appears in boxscore-20260913_SF@SEA.json's playerStats but is not a
    // scored position, so listPlayers() never mints a `players` row for it. A stat line
    // referencing it would be a foreign-key failure at seed time.
    const players = await provider().listPlayers();
    expect(players.some((p) => p.id === "10024")).toBe(false);
    const lines = await provider().getWeeklyStatLines(1);
    expect(lines.some((l) => l.playerId === "10024")).toBe(false);
  });

  it("drops a box-score stat line for a player on neither of the game's two teams", async () => {
    // The bug this guards against: a box score keyed to the wrong fixture, or one that leaks a
    // player from a third team, would otherwise attribute real points to a real, listed player
    // in a game they did not play — the case the listed-players filter alone cannot catch, since
    // that player is legitimately listed, just not in this game.
    const players = [
      { playerID: "1", longName: "Home Player", pos: "WR", team: "SEA" },
      { playerID: "2", longName: "Away Player", pos: "WR", team: "SF" },
      { playerID: "3", longName: "Stray Player", pos: "WR", team: "KC" },
    ];
    const box = {
      gameID: "20260913_SF@SEA",
      playerStats: {
        "1": { playerID: "1", Receiving: { receptions: "3", recYds: "40" } },
        "2": { playerID: "2", Receiving: { receptions: "2", recYds: "20" } },
        "3": { playerID: "3", Receiving: { receptions: "9", recYds: "150" } },
      },
    };
    const fetchStub: typeof globalThis.fetch = async (input) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.pathname === TANK01_CONFIG.paths.playerList) {
        return new Response(JSON.stringify({ statusCode: 200, body: players }), { status: 200 });
      }
      if (url.pathname === TANK01_CONFIG.paths.teams) {
        return new Response(JSON.stringify({ statusCode: 200, body: [] }), { status: 200 });
      }
      if (url.pathname === TANK01_CONFIG.paths.boxScore) {
        return new Response(JSON.stringify({ statusCode: 200, body: box }), { status: 200 });
      }
      throw new Error(`unexpected request to ${url.pathname}`);
    };
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: fetchStub, season: 2026 });
    const game = { gameId: "20260913_SF@SEA", week: 1, status: "final" as const, homeNflTeam: "SEA", awayNflTeam: "SF" };
    const lines = await subject.getGameStatLines(game);
    expect(lines.map((line) => line.playerId).sort()).toEqual(["1", "2"]);
  });

  it("answers an out-of-season week without making a request at all", async () => {
    // The fixture fetch throws by name on anything unrecorded, and there IS a recorded week-99
    // schedule, so this passing proves the short circuit rather than proving the fixture exists.
    let calls = 0;
    const counting: typeof globalThis.fetch = (...args) => {
      calls += 1;
      return createFixtureFetch()(...args);
    };
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: counting, season: 2026 });
    expect(await subject.getWeeklyStatLines(99)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("turns a 401 into a typed unauthorized failure that names the env var", async () => {
    const unauthorized: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid API key." }), { status: 401 });
    const subject = createTank01StatsProvider({ apiKey: "wrong", fetch: unauthorized });
    await expect(subject.listPlayers()).rejects.toMatchObject({ name: Tank01Error.name, kind: "unauthorized" });
    await expect(subject.listPlayers()).rejects.toThrow(TANK01_CONFIG.envVars.apiKey);
  });

  it("turns a 429 into a typed rate_limited failure", async () => {
    const limited: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: limited });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("turns a 403 into a typed forbidden failure naming the missing subscription", async () => {
    const notSubscribed: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "You are not subscribed to this API." }), { status: 403 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: notSubscribed });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("turns any other non-ok HTTP status into a typed upstream failure", async () => {
    const serverError: typeof globalThis.fetch = async () => new Response("Internal Server Error", { status: 500 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: serverError });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "upstream" });
  });

  it("turns a non-JSON body into a typed malformed failure", async () => {
    const notJson: typeof globalThis.fetch = async () => new Response("<html>not json</html>", { status: 200 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: notJson });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("turns a 200 with neither a body nor an error key into a typed malformed failure", async () => {
    const noBody: typeof globalThis.fetch = async () => new Response(JSON.stringify({ statusCode: 200 }), { status: 200 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: noBody });
    await expect(subject.listPlayers()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("treats an HTTP 200 carrying an error key as a failure, not as an empty week", async () => {
    // The single most dangerous upstream behavior: a refused request answers 200 with an empty
    // body, which a status-only check would map to zero stat lines and nobody would notice.
    const refused: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ statusCode: 200, body: {}, error: "playerID or teamID is a required parameter" }), { status: 200 });
    const subject = createTank01StatsProvider({ apiKey: "test-key", fetch: refused });
    await expect(subject.listPlayers()).rejects.toMatchObject({ name: Tank01Error.name, kind: "upstream" });
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
