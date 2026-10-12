import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { playerPeekFacts } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { jobs } from "@/db/schema";
import { CAPSULE_CONFIG } from "@research-ts/capsules/config";
import { getStoredCapsule, REGENERATE_FACTS_HASH, RETRY_FIRST_FACTS_HASH } from "@research-ts/capsules/store";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { JOBS_CONFIG } from "../config";
import { reservedMsPerPlayer } from "@research-ts/capsules/sweep";
import { runCapsuleSweepStep } from "./capsule-sweep-job";

const CLOCK = { now: () => "2026-09-04T12:00:00.000Z" };

function okResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost: 0.00005 } }), { status: 200 });
}

/** No numbers and no names, so it grounds for any player, in drafting words so it clears the
 *  banned-vocabulary rule (founder ruling, 2026-09-07). */
const GOOD_COMPACT =
  "This is the back his offense runs through, and drafters are taking him later than the case says they should. Our number backs the role against his board rank, and the range from top to bottom still lands him firmly in his tier. Draft him with confidence at his current ADP, he anchors the offense every single week without fail, and the whole coaching staff plainly builds the game plan around keeping him involved on early downs and on passing downs alike, which is the whole reason the case holds together from the first week to the last week.";
const GOOD_FULL =
  `${GOOD_COMPACT} The case only gets stronger once you look at the full picture: our number sits well clear of his ADP, and his board rank backs up the case plainly. He is the workhorse of his offense, the engine of a unit that leans on him on early downs and in the passing game alike, and that workload level is exactly why the range still lands him firmly in his tier from top to bottom this year. Nothing in the fact sheet points to a real downside here, so the call is simple: draft him at his current ADP, full stop, book him with confidence on your board this season and do not look back at all, because the whole shape of his offense points the same direction week after week and there is no reason to expect that to change any time soon this fall. plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably steadily really overall plainly frankly truly clearly simply further notably.`;

/** ONE CALL PER PLAYER (refrains round, 2026-09-07): a fixture answers the bundle request with one
 *  JSON object carrying both reads and the narrative, exactly as the gateway does. `narrative` is
 *  the slot object that object carries, empty by default. */
function bundleFetch(narrative: Readonly<Record<string, string>> = {}, prompts: string[] = []): typeof globalThis.fetch {
  return (async (_url: unknown, init: unknown) => {
    const { messages } = JSON.parse((init as RequestInit).body as string) as { messages: { content: string }[] };
    prompts.push(messages[1]!.content);
    return okResponse(JSON.stringify({ compact: GOOD_COMPACT, full: GOOD_FULL, narrative }));
  }) as typeof globalThis.fetch;
}

const sizeAwareFetch = (): typeof globalThis.fetch => bundleFetch();

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
    // The one call failed on the dead gateway, so the narrative reports its own failure line too;
    // the size label is what this test is about and it still reads "throttled".
    expect(outcome.detail).toContain("Rashad Long: template (throttled)");
  });

  it("labels a detail line \"template (failed validation: ...)\" quoting the first violation when the gateway talks but the content fails the validator", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    // Twenty-plus words (the degenerate-completion guard retries anything shorter) that still fail validation: "999" traces to no fact.
    const fabricatedBody = "He will score 999 touchdowns this year for this offense, an absurd fabricated number that nobody on the fact sheet has ever hit, and drafters simply cannot rank a season like that.";
    const fabricatingFetch = async () => okResponse(JSON.stringify({ compact: fabricatedBody, full: fabricatedBody, narrative: {} }));
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
 * A WRITTEN PLAYER IS NOT DEMOTED SILENTLY (overruns round, 2026-09-08). Derrick Henry had a written
 * read; a regeneration after his facts moved failed validation, the template replaced it, and the
 * detail line read like any other template fallback. The old read cannot be kept (its facts are
 * gone), but the sweep now says what happened and puts him at the front of the next run.
 */
describe("runCapsuleSweepStep — a written player whose regeneration fails", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  /** Twenty-plus words that fail grounding: "999" traces to no fact. */
  const FABRICATED = "He will score 999 touchdowns this year for this offense, an absurd fabricated number that nobody on the fact sheet has ever hit, and drafters simply cannot rank a season like that.";
  const fabricatingFetch = (async () => okResponse(JSON.stringify({ compact: FABRICATED, full: FABRICATED, narrative: {} }))) as typeof globalThis.fetch;

  async function moveFactsOf(nflId: string, points: number): Promise<void> {
    await db.update(preseasonProjections).set({ projectedPoints: points, medianPoints: points }).where(eq(preseasonProjections.playerId, nflId));
  }

  it('says "kept nothing, was written" in the detail line and stamps him to go first next run', async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});
    expect((await getStoredCapsule(db, "p1"))?.source).toBe("llm");
    await moveFactsOf("00-1", 200);

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fabricatingFetch }, {});

    const line = outcome.detail.find((entry) => entry.startsWith("Rashad Long: template"))!;
    expect(line).toMatch(/^Rashad Long: template \(failed validation: .+\), kept nothing, was written$/);
    expect(outcome.summary).toContain("1 written player(s) fell to the template and go first next run");
    const stored = await getStoredCapsule(db, "p1");
    expect(stored?.source).toBe("template");
    expect(stored?.factsHash).toBe(RETRY_FIRST_FACTS_HASH);
  });

  it("retries him at the front of the next run, ahead of the board order", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Player One", rank: 1, points: 248 });
    await seedPlayer(db, { id: "p2", nflId: "00-2", name: "Player Two", rank: 2, points: 220 });
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});
    // Player Two's facts move and his regeneration fails (the fixture fabricates for him alone:
    // the first run's sameness check queues both players, since they share one read); then Player
    // One's facts move too, so both are eligible and board order alone would put Player One first.
    await moveFactsOf("00-2", 180);
    const failingPlayerTwo = (async (url: unknown, init: unknown) => {
      const { messages } = JSON.parse((init as RequestInit).body as string) as { messages: { content: string }[] };
      return messages[1]!.content.includes("Player Two") ? fabricatingFetch(url as never, init as never) : sizeAwareFetch()(url as never, init as never);
    }) as typeof globalThis.fetch;
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: failingPlayerTwo }, {});
    expect((await getStoredCapsule(db, "p2"))?.factsHash).toBe(RETRY_FIRST_FACTS_HASH);
    expect((await getStoredCapsule(db, "p1"))?.factsHash).not.toBe(RETRY_FIRST_FACTS_HASH);
    await moveFactsOf("00-1", 230);

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, { budget: 1 });

    expect(outcome.summary).toContain("2 needed a fresh generation");
    expect(outcome.detail).toContain("Player Two: llm, $0.000050");
    expect((await getStoredCapsule(db, "p2"))?.source).toBe("llm");
    expect((await getStoredCapsule(db, "p2"))?.factsHash).not.toBe(RETRY_FIRST_FACTS_HASH);
    expect(outcome.summary).toContain("1 left for the next sweep");
  });

  it("gives the front of the line once: a player who fails again from the template is an ordinary template row", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-1", name: "Rashad Long", rank: 1, points: 248 });
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch() }, {});
    await moveFactsOf("00-1", 200);
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fabricatingFetch }, {});

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: fabricatingFetch }, {});

    const line = outcome.detail.find((entry) => entry.startsWith("Rashad Long: template"))!;
    expect(line).not.toContain("kept nothing");
    expect(outcome.summary).not.toContain("fell to the template and go first");
    const stored = await getStoredCapsule(db, "p1");
    expect(stored?.source).toBe("template");
    expect(stored?.factsHash).not.toBe(RETRY_FIRST_FACTS_HASH);
  });
});

/**
 * THE NIGHTLY BUDGET COVERS EVERYONE (overruns round, 2026-09-08). The 35-a-night cap predates the
 * resumable sweep and the 12-calls-a-minute pacing; a demoted player was waiting days for his turn
 * in the tail. The budget now covers the whole board, and the per-player reserve the tick geometry
 * is built on states the four-call ceiling a player can actually cost.
 */
describe("the nightly budget and the tick geometry", () => {
  /** The board the production regeneration of 2026-09-08 wrote. */
  const BOARD_TODAY = 664;

  it("covers today's whole board in one night", () => {
    expect(CAPSULE_CONFIG.sweepGenerationBudget).toBeGreaterThanOrEqual(BOARD_TODAY);
  });

  it("reserves the four-call ceiling a player can cost, and the default tick still fits one player", () => {
    const { sweepPacingMs, maxGatewayCallsPerPlayer, gateway } = CAPSULE_CONFIG;
    expect(reservedMsPerPlayer()).toBe(sweepPacingMs + maxGatewayCallsPerPlayer * gateway.minCallSpacingMs + gateway.timeoutMs);
    expect(reservedMsPerPlayer()).toBeLessThanOrEqual(JOBS_CONFIG.vercelTickBudgetMsDefault);
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
    // Production geometry: the step reserves 40s a player (the four-call ceiling at the gateway's
    // own 5s spacing plus one 20s gateway timeout). One clock read is spent on the pass's own
    // `asOf`, so with a 10s step the first loop check sits at 10s and fits inside a 50s window
    // exactly, and the second sits at 20s and does not. `pacingMs: 0` only stops the test
    // sleeping; the reserve is the production one.
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
    // The budget production runs at (JOBS_TICK_BUDGET_MS=280000). At a 40s reserve and a clock
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
    // A deadline ten seconds out, against a 40s reserve: the guard fires on the first iteration.
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

  /** The bundle fixture with a narrative in it, so the run actually stores a narrative. */
  function narrativeFetch(prompts: string[] = []): typeof globalThis.fetch {
    return bundleFetch({ call: STOCK }, prompts);
  }

  async function seedTwo(): Promise<void> {
    for (const index of [1, 2]) {
      await seedPlayer(db, { id: `p${index}`, nflId: `00-${index}`, name: `Player ${index}`, rank: index, points: 250 - index });
    }
  }

  it("flags a sentence the whole board is saying and stamps both players for regeneration", async () => {
    await seedTwo();

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(), pacingMs: 0 }, {});

    expect(outcome.summary).toContain("1 stock sentence(s) found");
    expect(outcome.summary).toContain("2 player(s) queued");
    expect((await getStoredCapsule(db, "p1"))?.narrative).toEqual({ call: STOCK });
    expect((await getStoredCapsule(db, "p1"))?.factsHash).toBe(REGENERATE_FACTS_HASH);
    expect((await getStoredCapsule(db, "p2"))?.factsHash).toBe(REGENERATE_FACTS_HASH);
  });

  /** THE SAMENESS CHAIN (refrains round, 2026-09-07) — the fixture writes every player the same
   *  reads, so the whole board shares one opener family and one refrain ("the engine of"): both are
   *  flagged, both players are queued, and the next run's prompt names the flagged phrases. */
  it("flags a shared opener family and refrain across the board, queues the players, and quotes the phrases into the next prompt", async () => {
    await seedTwo();

    const outcome = await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: sizeAwareFetch(), pacingMs: 0 }, {});

    expect(outcome.summary).toMatch(/[1-9]\d* sameness flag\(s\), 2 player\(s\) queued/);
    expect(outcome.detail.some((line) => line.startsWith("opener family on 2 players (100.0%)"))).toBe(true);
    expect(outcome.detail).toContain('refrain on 2 players (100.0%): "the engine of"');
    expect((await getStoredCapsule(db, "p1"))?.factsHash).toBe(REGENERATE_FACTS_HASH);

    const prompts: string[] = [];
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: bundleFetch({}, prompts), pacingMs: 0 }, {});
    const bundlePrompt = prompts.find((prompt) => prompt.includes("Return ONE JSON object"))!;
    expect(bundlePrompt).toContain("already on too many other players' pages");
    expect(bundlePrompt).toContain("the engine of");
    // The opener family's example is the first four words, in a player's own words.
    expect(bundlePrompt).toContain('"This is the back"');
  });

  it("quotes the flagged sentence into the next run's own prompt", async () => {
    await seedTwo();
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(), pacingMs: 0 }, {});

    // The stamped hash makes both players eligible again, and this run's avoid list is computed
    // from what the board is still saying, so the flagged sentence reaches the prompt verbatim.
    const prompts: string[] = [];
    await runCapsuleSweepStep(db, CLOCK, { apiKey: "test-key", fetch: narrativeFetch(prompts), pacingMs: 0 }, {});

    const bundlePrompt = prompts.find((prompt) => prompt.includes("Return ONE JSON object"));
    expect(bundlePrompt).toBeDefined();
    expect(bundlePrompt).toContain("Do not write them");
    expect(bundlePrompt).toContain(STOCK);
  });
});
