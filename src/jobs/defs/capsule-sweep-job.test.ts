import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { nflPlayers, playerCrosswalk, playerPeekFacts, players, preseasonProjections } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { getStoredCapsule } from "@/capsules/store";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { runCapsuleSweepStep } from "./capsule-sweep-job";

const CLOCK = { now: () => "2026-09-04T12:00:00.000Z" };

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0.00005 } }), { status: 200 });
}

const GOOD_COMPACT =
  "This player is a clear buy for his offense this season. Our number backs the price against his board rank and market slot, and the range from top to bottom still lands him firmly in his tier. Draft him with confidence at his current price this season, he anchors the offense every single week without fail, and the whole coaching staff plainly builds the game plan around keeping him involved on early downs and on passing downs alike.";
const GOOD_FULL =
  `${GOOD_COMPACT} The case only gets stronger once you look at the full picture: our number sits well clear of his market slot, and his board rank backs up the price plainly. He is the workhorse of his offense, the engine of a unit that leans on him on early downs and in the passing game alike, and that workload level is exactly why the range still lands him firmly in his tier from top to bottom this year. Nothing in the fact sheet points to a real downside here, so the call is simple: he is a buy at his current market price, full stop, book him with confidence on your board this season and do not look back at all, because the whole shape of his offense points the same direction week after week and there is no reason to expect that to change any time soon this fall.`;

/** A fetch fixture size-aware the way a real gateway response is: `write.ts`'s own size
 *  instruction text names the size directly, so a fixture can answer each request with a body
 *  that actually clears that size's own word band. */
function sizeAwareFetch(): typeof globalThis.fetch {
  return (async (_url: unknown, init: unknown) => {
    const { messages } = JSON.parse((init as RequestInit).body as string) as { messages: { content: string }[] };
    const isFull = messages[1]!.content.includes("(1) the volume or role case");
    return okResponse(isFull ? GOOD_FULL : GOOD_COMPACT);
  }) as typeof globalThis.fetch;
}

async function seedPlayer(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly rank: number; readonly points: number }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: "RB" });
  await db.insert(players).values({ id: input.id, name: input.name, position: "RB", nflTeam: "SF", adp: 10 });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON,
    source: BOARD_SOURCE,
    playerId: input.nflId,
    rank: input.rank,
    positionRank: 1,
    projectedPoints: input.points,
    valueOverReplacement: input.points,
    valueRank: input.rank,
    expectedGames: 17,
    floorPoints: input.points - 20,
    medianPoints: input.points,
    ceilingPoints: input.points + 20,
    tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"),
    momentKind: "live",
  });
}

describe("runCapsuleSweepStep", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("writes a fresh llm capsule for a board player with no existing row", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    const fetchMock = sizeAwareFetch();

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fetchMock }, {});
    expect(outcome.summary).toContain("1 board players");
    expect(outcome.summary).toContain("1 needed a fresh generation");
    expect(outcome.summary).toContain("1 llm");

    const stored = await getStoredCapsule(db, "p1");
    expect(stored?.source).toBe("llm");
    expect(stored?.bodyCompact).toBe(GOOD_COMPACT);
    expect(stored?.bodyFull).toBe(GOOD_FULL);
  });

  it("skips a player whose stored llm capsule already matches the current facts hash", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    const fetchMock = sizeAwareFetch();
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fetchMock }, {});

    let calls = 0;
    const countingFetch = (async (url: unknown, init: unknown) => {
      calls += 1;
      return sizeAwareFetch()(url as never, init as never);
    }) as typeof globalThis.fetch;
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: countingFetch }, {});
    expect(outcome.summary).toContain("0 needed a fresh generation");
    expect(calls).toBe(0);
  });

  it("keeps retrying a template-sourced row on every sweep, even when its facts hash has not moved", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    const failingFetch = async () => new Response("bad request", { status: 401 });
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: failingFetch }, {});
    const first = await getStoredCapsule(db, "p1");
    expect(first?.source).toBe("template");

    const recoveredFetch = sizeAwareFetch();
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: recoveredFetch }, {});
    expect(outcome.summary).toContain("1 needed a fresh generation");
    const second = await getStoredCapsule(db, "p1");
    expect(second?.source).toBe("llm");
  });

  /** THE LABELED DETAIL (sweep resilience, color v2, Task 4) — an operator scanning a sweep's own
   *  detail lines must be able to tell "the gateway never gave us anything" apart from "the
   *  gateway talked, the content failed the validator" at a glance. */
  it("labels a detail line \"template (throttled)\" when the gateway never returns a usable response", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    const failingFetch = async () => new Response("bad request", { status: 401 });
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: failingFetch }, {});
    // The narrative is a third call on the same dead gateway and reports its own failure line;
    // the size label is what this test is about and it still reads "throttled".
    expect(outcome.detail).toContain("Rashad Long: template (throttled)");
  });

  it("labels a detail line \"template (failed validation: ...)\" quoting the first violation when the gateway talks but the content fails the validator", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    // Twenty-plus words (the degenerate-completion guard retries anything shorter) that still fail validation: "999" traces to no fact.
    const fabricatedBody = "He will score 999 touchdowns this year for this offense, an absurd fabricated number that nobody on the fact sheet has ever hit, and the market simply cannot price a season like that.";
    const fabricatingFetch = async () => okResponse(fabricatedBody);
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fabricatingFetch }, {});
    const sizeLabel = outcome.detail.find((line) => line.startsWith("Rashad Long: template"))!;
    expect(sizeLabel).toMatch(/^Rashad Long: template \(failed validation: .+\)$/);
    expect(sizeLabel).not.toContain("throttled");
  });

  it("bounds a run to its own generation budget, leaving the rest for the next sweep", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    await seedPlayer(db, { id: "p2", nflId: "00-2", name: "Player Two", rank: 2, points: 220 });
    const fetchMock = sizeAwareFetch();

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fetchMock }, { budget: 1 });
    expect(outcome.summary).toContain("2 needed a fresh generation");
    expect(outcome.summary).toContain("1 processed");
    expect(outcome.summary).toContain("1 left for the next sweep");

    const stored = [await getStoredCapsule(db, "p1"), await getStoredCapsule(db, "p2")];
    expect(stored.filter((s) => s !== null)).toHaveLength(1);
  });

  it("returns an honest zero-player summary when the board is empty", async () => {
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key" }, {});
    expect(outcome.summary).toContain("0 board players");
  });

  /** THE SWEEP IS ALSO THE PEEK-FACTS WRITER (peek-facts design §3.2) — one pass, two products. */
  it("writes one precomputed peek row per board player from the same pass", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    await seedPlayer(db, { id: "p2", nflId: "00-2", name: "Player Two", rank: 2, points: 220 });

    // A budget of one, deliberately: the peek rows come off the PASS, so every board player gets
    // one whatever the capsule generation budget happens to be that night.
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, { budget: 1 });
    expect(outcome.summary).toContain("Peek facts: 2 rows built, 2 changed");

    const rows = await db.select().from(playerPeekFacts);
    expect(rows.map((row) => row.playerId).sort()).toEqual(["p1", "p2"]);
  });

  it("changes no peek row on a second sweep at the same moment", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});

    const second = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});
    expect(second.summary).toContain("Peek facts: 1 rows built, 0 changed");
    expect(await db.select().from(playerPeekFacts)).toHaveLength(1);
  });

  it("writes the peek rows even when every capsule generation is throttled", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    const failingFetch = async () => new Response("bad request", { status: 401 });

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: failingFetch }, {});
    expect(outcome.summary).toContain("Peek facts: 1 rows built, 1 changed");
    expect(await db.select().from(playerPeekFacts)).toHaveLength(1);
  });
});
