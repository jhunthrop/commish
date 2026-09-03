import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import {
  archivedEventIds,
  countPropObservations,
  parseEventOddsResponse,
  recordPropObservations,
  type PlayerPropObservation,
} from "./props-store";

const db = createTestDb();

const FIXTURE_PATH = join(__dirname, "fixtures/event-odds-week1.json");
const FETCHED_AT = new Date("2026-09-01T15:00:00.000Z");

function loadFixture(): unknown {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

function clonePayload(mutate: (payload: Record<string, unknown>) => void): unknown {
  const payload = loadFixture() as Record<string, unknown>;
  mutate(payload);
  return payload;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("parseEventOddsResponse — the pure event-odds-to-observations mapping", () => {
  it("parses every bookmaker's every market into one row per Over/Under pair", () => {
    const { observations, skippedUnpaired } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    // draftkings: pass_yds(1) + rush_yds(2 players) + reception_yds(1) + receptions(1) = 5
    // fanduel: pass_yds(1) = 1
    expect(observations).toHaveLength(6);
    expect(skippedUnpaired).toEqual([]);
    expect(new Set(observations.map((o) => o.bookmaker))).toEqual(new Set(["draftkings", "fanduel"]));
    expect(new Set(observations.map((o) => o.market))).toEqual(
      new Set(["player_pass_yds", "player_rush_yds", "player_reception_yds", "player_receptions"]),
    );
  });

  it("carries the event id and commence time onto every row, unmodified", () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    expect(observations.every((o) => o.eventId === "e91230456789abcdef0123456789abcd")).toBe(true);
    expect(observations.every((o) => o.commenceTime.toISOString() === "2026-09-05T00:20:00.000Z")).toBe(true);
  });

  it("stamps every row with the injected fetchedAt, not a value from the payload", () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    expect(observations.every((o) => o.fetchedAt === FETCHED_AT)).toBe(true);
  });

  it("pairs Over and Under prices onto one row for the same player and point", () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    const mahomesDk = observations.find((o) => o.bookmaker === "draftkings" && o.playerName === "Patrick Mahomes");
    expect(mahomesDk).toEqual<PlayerPropObservation>({
      eventId: "e91230456789abcdef0123456789abcd",
      commenceTime: new Date("2026-09-05T00:20:00.000Z"),
      bookmaker: "draftkings",
      market: "player_pass_yds",
      playerName: "Patrick Mahomes",
      point: 275.5,
      overPrice: -115,
      underPrice: -105,
      fetchedAt: FETCHED_AT,
    });
  });

  it("keeps two different bookmakers' lines for the same player as two separate rows", () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    const mahomesRows = observations.filter((o) => o.playerName === "Patrick Mahomes" && o.market === "player_pass_yds");
    expect(mahomesRows).toHaveLength(2);
    expect(mahomesRows.map((o) => o.bookmaker).sort()).toEqual(["draftkings", "fanduel"]);
    expect(mahomesRows.map((o) => o.point).sort()).toEqual([275.5, 277.5]);
  });

  it("keeps two different players in the same market as two separate rows", () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    const rushRows = observations.filter((o) => o.bookmaker === "draftkings" && o.market === "player_rush_yds");
    expect(rushRows.map((o) => o.playerName).sort()).toEqual(["Isiah Pacheco", "Justin Herbert"]);
  });

  it("returns no observations and no skips for an event with no bookmakers posted yet, without erroring", () => {
    const payload = clonePayload((p) => {
      delete p.bookmakers;
    });
    expect(parseEventOddsResponse(payload, FETCHED_AT)).toEqual({ observations: [], skippedUnpaired: [] });
  });

  it("rejects an unknown market loudly, naming the offending market key", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ key: string }> }>;
      bookmakers[0].markets[0].key = "player_anytime_td";
    });
    expect(() => parseEventOddsResponse(payload, FETCHED_AT)).toThrow(/unknown market "player_anytime_td"/);
  });

  it("rejects an outcome with a missing point loudly", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      delete bookmakers[0].markets[0].outcomes[0].point;
    });
    expect(() => parseEventOddsResponse(payload, FETCHED_AT)).toThrow(/expected a finite number/);
  });

  it("skips an unpaired Over outcome (no matching Under) rather than throwing, and reports it", () => {
    // Verified against a real live response (betrivers, player_receptions, Cooper Kupp at 2.5):
    // some books genuinely post a single-sided line. That is a market fact, not a malformed
    // payload, so this drops the line and reports it instead of failing the whole response.
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      // player_pass_yds carries exactly one Over and one Under; drop the Under.
      bookmakers[0].markets[0].outcomes.splice(1, 1);
    });
    const { observations, skippedUnpaired } = parseEventOddsResponse(payload, FETCHED_AT);
    expect(skippedUnpaired).toEqual([
      {
        bookmaker: "draftkings",
        market: "player_pass_yds",
        playerName: "Patrick Mahomes",
        point: 275.5,
        reason: "unpaired",
        presentSide: "Over",
      },
    ]);
    // Everything else in the payload still lands.
    expect(observations).toHaveLength(5);
    expect(observations.some((o) => o.bookmaker === "draftkings" && o.market === "player_pass_yds")).toBe(false);
  });

  it("skips a duplicate Over for the same player and point rather than throwing, and reports it", () => {
    // A real archive payload (2025 historical backfill, week 2-ish) hit exactly this shape:
    // `duplicate Over outcome for "Jahmyr Gibbs" at point 2.5` -- a book's snapshot preserving a
    // stale price beside its own update, not a malformed response. Ambiguous prices; refuse to
    // guess which is live, drop the WHOLE pair (both sides, even though Under arrived cleanly),
    // and report it instead of killing the whole run over one book's mess.
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      const outcomes = bookmakers[0].markets[0].outcomes;
      outcomes.push({ ...outcomes[0] }); // a second "Over" for Mahomes at 275.5
    });
    const { observations, skippedUnpaired } = parseEventOddsResponse(payload, FETCHED_AT);
    expect(skippedUnpaired).toEqual([
      {
        bookmaker: "draftkings",
        market: "player_pass_yds",
        playerName: "Patrick Mahomes",
        point: 275.5,
        reason: "duplicate",
        presentSide: "Over",
      },
    ]);
    // The whole pair is dropped, including the Under that arrived cleanly before the duplicate.
    expect(observations.some((o) => o.bookmaker === "draftkings" && o.market === "player_pass_yds")).toBe(false);
    // Everything else in the payload -- other markets, other players, the other bookmaker -- lands.
    expect(observations).toHaveLength(5);
  });

  it("skips a duplicate Under symmetrically, and reports it", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      const outcomes = bookmakers[0].markets[0].outcomes;
      outcomes.push({ ...outcomes[1] }); // a second "Under" for Mahomes at 275.5
    });
    const { observations, skippedUnpaired } = parseEventOddsResponse(payload, FETCHED_AT);
    expect(skippedUnpaired).toEqual([
      {
        bookmaker: "draftkings",
        market: "player_pass_yds",
        playerName: "Patrick Mahomes",
        point: 275.5,
        reason: "duplicate",
        presentSide: "Under",
      },
    ]);
    expect(observations).toHaveLength(5);
  });

  it("reports one skip for a player+point duplicated three times, not two", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      const outcomes = bookmakers[0].markets[0].outcomes;
      outcomes.push({ ...outcomes[0] }, { ...outcomes[0] }); // Over listed three times total
    });
    const { skippedUnpaired } = parseEventOddsResponse(payload, FETCHED_AT);
    expect(skippedUnpaired).toHaveLength(1);
    expect(skippedUnpaired[0]).toMatchObject({ playerName: "Patrick Mahomes", reason: "duplicate" });
  });

  it("drops only the duplicated pair, not other players in the same market or other books", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      // player_rush_yds carries two players (Pacheco, Herbert); duplicate only Pacheco's Over.
      const rushOutcomes = bookmakers[0].markets[1].outcomes;
      rushOutcomes.push({ ...rushOutcomes[0] });
    });
    const { observations, skippedUnpaired } = parseEventOddsResponse(payload, FETCHED_AT);
    expect(skippedUnpaired).toEqual([
      { bookmaker: "draftkings", market: "player_rush_yds", playerName: "Isiah Pacheco", point: 55.5, reason: "duplicate", presentSide: "Over" },
    ]);
    expect(observations.some((o) => o.playerName === "Isiah Pacheco")).toBe(false);
    expect(observations.some((o) => o.playerName === "Justin Herbert" && o.market === "player_rush_yds")).toBe(true);
    expect(observations.some((o) => o.bookmaker === "fanduel" && o.playerName === "Patrick Mahomes")).toBe(true);
    expect(observations).toHaveLength(5);
  });

  it("rejects an outcome name that is neither Over nor Under loudly", () => {
    const payload = clonePayload((p) => {
      const bookmakers = p.bookmakers as Array<{ markets: Array<{ outcomes: Array<Record<string, unknown>> }> }>;
      bookmakers[0].markets[0].outcomes[0].name = "Yes";
    });
    expect(() => parseEventOddsResponse(payload, FETCHED_AT)).toThrow(/expected "Over" or "Under"/);
  });

  it("rejects a response missing its event id loudly", () => {
    const payload = clonePayload((p) => {
      delete p.id;
    });
    expect(() => parseEventOddsResponse(payload, FETCHED_AT)).toThrow(/response\.id/);
  });

  it("rejects a response with an unparseable commence_time loudly", () => {
    const payload = clonePayload((p) => {
      p.commence_time = "not-a-date";
    });
    expect(() => parseEventOddsResponse(payload, FETCHED_AT)).toThrow(/unparseable date/);
  });
});

describe("recordPropObservations / countPropObservations — the append-only write path", () => {
  it("writes every parsed observation and reports it back grouped by event and market", async () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    const written = await recordPropObservations(db, observations);
    expect(written).toBe(6);

    const counts = await countPropObservations(db, FETCHED_AT);
    expect(counts.total).toBe(6);
    expect(counts.byEventMarket.get("e91230456789abcdef0123456789abcd|player_pass_yds")).toBe(2);
    expect(counts.byEventMarket.get("e91230456789abcdef0123456789abcd|player_rush_yds")).toBe(2);
    expect(counts.byEventMarket.get("e91230456789abcdef0123456789abcd|player_reception_yds")).toBe(1);
    expect(counts.byEventMarket.get("e91230456789abcdef0123456789abcd|player_receptions")).toBe(1);
  });

  it("never upserts: writing the same snapshot twice inserts a second full set of rows", async () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    await recordPropObservations(db, observations);
    const secondFetch = new Date("2026-09-02T15:00:00.000Z");
    const secondRun = observations.map((o) => ({ ...o, fetchedAt: secondFetch }));
    const written = await recordPropObservations(db, secondRun);
    expect(written).toBe(6);

    const firstCounts = await countPropObservations(db, FETCHED_AT);
    const secondCounts = await countPropObservations(db, secondFetch);
    expect(firstCounts.total).toBe(6);
    expect(secondCounts.total).toBe(6);
  });

  it("writes an identical repeated snapshot (same fetchedAt) as new rows too -- no fact key dedupes", async () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    await recordPropObservations(db, observations);
    const written = await recordPropObservations(db, observations);
    expect(written).toBe(6);

    const counts = await countPropObservations(db, FETCHED_AT);
    expect(counts.total).toBe(12);
  });

  it("returns zero total for a fetchedAt the store never saw", async () => {
    const counts = await countPropObservations(db, new Date("2020-01-01T00:00:00.000Z"));
    expect(counts.total).toBe(0);
    expect(counts.byEventMarket.size).toBe(0);
  });
});

describe("archivedEventIds — the backfill's own resume/skip check", () => {
  it("returns every distinct event id the store holds any observation for", async () => {
    const { observations } = parseEventOddsResponse(loadFixture(), FETCHED_AT);
    await recordPropObservations(db, observations);
    expect(await archivedEventIds(db)).toEqual(new Set(["e91230456789abcdef0123456789abcd"]));
  });

  it("returns an empty set when the store holds nothing", async () => {
    expect(await archivedEventIds(db)).toEqual(new Set());
  });
});
