import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { nflPlayers, playerCrosswalk, playerPeekFacts, players, preseasonProjections } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { jobs } from "@/db/schema";
import { getStoredCapsule, REGENERATE_FACTS_HASH } from "@/capsules/store";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { runCapsuleSweepStep } from "./capsule-sweep-job";

const CLOCK = { now: () => "2026-09-04T12:00:00.000Z" };

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0.00005 } }), { status: 200 });
}

const GOOD_COMPACT =
  "This player is a clear buy for his offense this season. Our number backs the price against his board rank and market slot, and the range from top to bottom still lands him firmly in his tier. Draft him with confidence at his current price this season, he anchors the offense every single week without fail, and the whole coaching staff plainly builds the game plan around keeping him involved on early downs and on passing downs alike plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further.";
const GOOD_FULL =
  `${GOOD_COMPACT} The case only gets stronger once you look at the full picture: our number sits well clear of his market slot, and his board rank backs up the price plainly. He is the workhorse of his offense, the engine of a unit that leans on him on early downs and in the passing game alike, and that workload level is exactly why the range still lands him firmly in his tier from top to bottom this year. Nothing in the fact sheet points to a real downside here, so the call is simple: he is a buy at his current market price, full stop, book him with confidence on your board this season and do not look back at all, because the whole shape of his offense points the same direction week after week and there is no reason to expect that to change any time soon this fall. plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably.`;

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

/**
 * RESUMABILITY (review C1) — the runner caps a claimed attempt at what is left of the TICK budget,
 * not at this job's own `timeoutMs`, so a 35-player batch was being cut off mid-run every night and
 * the repetition check at the end never ran at all. The step now stops before the deadline it is
 * handed and enqueues its own continuation.
 */
describe("runCapsuleSweepStep — across ticks", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  /** A clock that advances by `stepMs` on every read, so a loop that reads it per player walks
   *  toward the deadline without any real time passing. */
  function advancingClock(startIso: string, stepMs: number) {
    let now = new Date(startIso).getTime();
    return {
      now: () => {
        const iso = new Date(now).toISOString();
        now += stepMs;
        return iso;
      },
    };
  }

  it("a 50 second tick writes one player and hands the rest to a continuation", async () => {
    for (const index of [1, 2, 3]) {
      await seedPlayer(db, { id: `p${index}`, nflId: `00-${index}`, name: `Player ${index}`, rank: index, points: 250 - index });
    }
    // Production geometry: the step reserves 35s a player (three calls at the gateway's own 5s
    // spacing plus one 20s gateway timeout). One clock read is spent on the pass's own `asOf`, so
    // with a 10s step the first loop check sits at 10s and fits inside a 50s window, and the
    // second sits at 20s and does not. `pacingMs: 0` only stops the test sleeping; the reserve is
    // the production one.
    const clock = advancingClock("2026-09-04T12:00:00.000Z", 10_000);
    const outcome = await runCapsuleSweepStep(
      db,
      clock,
      { apiKey: "test-key", fetch: sizeAwareFetch(), pacingMs: 0 },
      { budget: 3 },
      new Date("2026-09-04T12:00:50.000Z"),
    );

    expect(outcome.summary).toContain("1 processed");
    expect(outcome.summary).toContain("continuing this tick's remainder in a follow-up run of 2");
    expect(outcome.summary).toContain("repetition check deferred");
    const queued = await db.select().from(jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.name).toBe("capsule-sweep");
    expect(queued[0]!.payload).toMatchObject({ budget: 2 });
    // What it wrote is written: a stop is safe because progress is persisted per player.
    expect((await getStoredCapsule(db, "p1"))?.source).toBe("llm");
    expect(await getStoredCapsule(db, "p2")).toBeNull();
  });

  it("a 280 second tick writes about ten", async () => {
    for (const index of Array.from({ length: 12 }, (_, i) => i + 1)) {
      await seedPlayer(db, { id: `p${index}`, nflId: `00-${index}`, name: `Player ${index}`, rank: index, points: 300 - index });
    }
    // The budget production runs at (JOBS_TICK_BUDGET_MS=280000). At a 35s reserve and a clock
    // that walks 25s a read, the run fits nine players and stops before the tenth.
    const clock = advancingClock("2026-09-04T12:00:00.000Z", 25_000);
    const outcome = await runCapsuleSweepStep(
      db,
      clock,
      { apiKey: "test-key", fetch: sizeAwareFetch(), pacingMs: 0 },
      { budget: 12 },
      new Date("2026-09-04T12:04:40.000Z"),
    );

    expect(outcome.summary).toContain("9 processed");
    expect(outcome.summary).toContain("continuing this tick's remainder in a follow-up run of 3");
    expect((await getStoredCapsule(db, "p9"))?.source).toBe("llm");
    expect(await getStoredCapsule(db, "p10")).toBeNull();
  });

  it("a tick with no room for even one player enqueues nothing and says why", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    // A deadline ten seconds out, against a 25s reserve: the guard fires on the first iteration.
    const outcome = await runCapsuleSweepStep(
      db,
      CLOCK,
      { apiKey: "test-key", fetch: sizeAwareFetch() },
      {},
      new Date("2026-09-04T12:00:10.000Z"),
    );

    expect(outcome.summary).toContain("0 processed");
    expect(outcome.summary).toContain("WROTE NOTHING: the tick budget was too small for one player");
    expect(outcome.detail.join(" ")).toContain("JOBS_TICK_BUDGET_MS");
    // No continuation: a zero-progress chain would carry the same budget under the same key and
    // either dedupe into nothing or spin.
    expect(await db.select().from(jobs)).toHaveLength(0);
    expect(await getStoredCapsule(db, "p1")).toBeNull();
  });

  it("processes the whole batch when nothing is holding a deadline over it", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});
    expect(outcome.summary).not.toContain("continuing this tick's remainder");
    expect(await db.select().from(jobs)).toHaveLength(0);
  });
});

/**
 * THE REPETITION WIRING (review I5) — the check, the queue and the avoid list are three pieces and
 * only the whole chain is worth anything: a stock sentence has to be written, counted, stamped for
 * regeneration, and then quoted into the NEXT run's own prompt.
 */
describe("runCapsuleSweepStep — the repetition chain", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  /** No numbers and no names, so it grounds for any player: the sweep will write it verbatim onto
   *  every player it touches, which is exactly the stock sentence the check exists to catch. */
  const STOCK = "He is the engine of that offense every single week.";

  /** The size-aware fixture plus a narrative answer, so the run actually stores a narrative. */
  function narrativeFetch(prompts: string[] = []): typeof globalThis.fetch {
    return (async (_url: unknown, init: unknown) => {
      const { messages } = JSON.parse((init as RequestInit).body as string) as { messages: { content: string }[] };
      const prompt = messages[1]!.content;
      prompts.push(prompt);
      if (prompt.includes("Return ONE JSON object")) return okResponse(JSON.stringify({ call: STOCK }));
      return okResponse(prompt.includes("(1) the volume or role case") ? GOOD_FULL : GOOD_COMPACT);
    }) as typeof globalThis.fetch;
  }

  async function seedTwo(): Promise<void> {
    for (const index of [1, 2]) {
      await seedPlayer(db, { id: `p${index}`, nflId: `00-${index}`, name: `Player ${index}`, rank: index, points: 250 - index });
    }
  }

  it("flags a sentence the whole board is saying and stamps both players for regeneration", async () => {
    await seedTwo();

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(), pacingMs: 0 }, {});

    expect(outcome.summary).toContain("1 stock sentence(s) found, 2 player(s) queued");
    expect((await getStoredCapsule(db, "p1"))?.narrative).toEqual({ call: STOCK });
    expect((await getStoredCapsule(db, "p1"))?.factsHash).toBe(REGENERATE_FACTS_HASH);
    expect((await getStoredCapsule(db, "p2"))?.factsHash).toBe(REGENERATE_FACTS_HASH);
  });

  it("quotes the flagged sentence into the next run's own prompt", async () => {
    await seedTwo();
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(), pacingMs: 0 }, {});

    // The stamped hash makes both players eligible again, and this run's avoid list is computed
    // from what the board is still saying, so the flagged sentence reaches the prompt verbatim.
    const prompts: string[] = [];
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(prompts), pacingMs: 0 }, {});

    const narrativePrompt = prompts.find((prompt) => prompt.includes("Return ONE JSON object"));
    expect(narrativePrompt).toBeDefined();
    expect(narrativePrompt).toContain("Do not write them");
    expect(narrativePrompt).toContain(STOCK);
  });
});
