import { describe, expect, it } from "vitest";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { copyViolations } from "@/integrity/copy-rules";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { MOCK_BOT_TEAM_NAME_POOL, MOCK_CONFIG, MOCK_COPY } from "./config";

/**
 * The 24 `botRoster` ids as shipped — load-bearing for replay (`rngFor` keys every bot's seeded
 * stream off its id, `./rng`'s own docblock). Task 2 (founder directive 2026-08-26) renamed every
 * `name`, never an `id`: this pin is what makes that promise a test rather than a claim.
 */
const EXPECTED_BOT_ROSTER_IDS = [
  "bot_park",
  "bot_earlybird",
  "bot_latenight",
  "bot_chalk",
  "bot_contrarian",
  "bot_sleeper",
  "bot_valuehunter",
  "bot_zerorb",
  "bot_workhorse",
  "bot_stacker",
  "bot_rookietruther",
  "bot_steadyvet",
  "bot_upside",
  "bot_safefloor",
  "bot_committee",
  "bot_benchdepth",
  "bot_streamer",
  "bot_hunch",
  "bot_spreadsheet",
  "bot_gutcheck",
  "bot_lastyear",
  "bot_riskaverse",
  "bot_boomorbust",
  "bot_homer",
];

/**
 * The founder's two honesty rules for a name a member sees beside a bot seat (owner handle or
 * team name alike): never spell "bot" or "AI" as a whole word (word-boundary, so "Auntie Vee" or
 * "The Waiver Wolves" are never falsely flagged for the "ai"/"bot" substrings buried inside an
 * unrelated word), and never carry any word from the strategy vocabulary a member could read a
 * bot's archetype off of.
 */
const BANNED_STRATEGY_VOCABULARY = [
  "zero rb",
  "sleeper",
  "chalk",
  "contrarian",
  "value",
  "upside",
  "floor",
  "stack",
  "streamer",
  "spreadsheet",
  "hunch",
  "boom",
  "bust",
  "workhorse",
  "committee",
  "rookie",
  "vet",
  "homer",
  "hometown",
  "risk",
];

function nameViolations(name: string): readonly string[] {
  const lower = name.toLowerCase();
  const violations: string[] = [];
  if (/\bbot\b/i.test(name)) violations.push("bot");
  if (/\bai\b/i.test(name)) violations.push("ai");
  for (const word of BANNED_STRATEGY_VOCABULARY) {
    if (lower.includes(word)) violations.push(word);
  }
  return violations;
}

describe("MOCK_CONFIG", () => {
  it("keeps every bot think-delay inside the fastest pick clock, with room for the human safety net", () => {
    const fastest = Math.min(...MOCK_CONFIG.pickClockSecondsOptions);
    expect(MOCK_CONFIG.botDelay.maxSeconds).toBeLessThan(fastest * MOCK_CONFIG.botDelay.maxFractionOfClock);
  });

  it("keeps the minimum bot think-delay below the maximum", () => {
    expect(MOCK_CONFIG.botDelay.minSeconds).toBeLessThan(MOCK_CONFIG.botDelay.maxSeconds);
  });

  it("holds a bot roster larger than the largest room, so the seat draw never runs dry", () => {
    expect(MOCK_CONFIG.botRoster.length).toBeGreaterThanOrEqual(Math.max(...MOCK_CONFIG.teamCountOptions) + 4);
    expect(new Set(MOCK_CONFIG.botRoster.map((b) => b.id)).size).toBe(MOCK_CONFIG.botRoster.length);
  });

  it("keeps every bot roster id byte-identical to what shipped — renaming an id re-deals every in-flight seed", () => {
    expect(MOCK_CONFIG.botRoster.map((b) => b.id)).toEqual(EXPECTED_BOT_ROSTER_IDS);
  });

  it("gives every bot a distinct, non-empty name", () => {
    const names = MOCK_CONFIG.botRoster.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("never lets a bot's owner handle spell out \"bot\"/\"AI\" or leak its archetype's strategy vocabulary", () => {
    for (const bot of MOCK_CONFIG.botRoster) {
      expect(nameViolations(bot.name), `botRoster name "${bot.name}"`).toEqual([]);
    }
  });

  it("defaults the pick clock to one of the offered options", () => {
    expect(MOCK_CONFIG.pickClockSecondsOptions).toContain(MOCK_CONFIG.defaultPickClockSeconds);
  });

  it("names exactly the three founder-required modes", () => {
    expect(MOCK_CONFIG.modes).toEqual(["solo", "lobby", "link"]);
  });

  it("orders retention windows from shortest to the completed room's day-long life", () => {
    const { unstartedMs, inProgressMs, completedMs } = MOCK_CONFIG.retention;
    expect(unstartedMs).toBeLessThan(inProgressMs);
    expect(inProgressMs).toBeLessThan(completedMs);
    expect(completedMs).toBe(24 * 60 * 60 * 1000);
  });

  it("gives lobby and link rooms time to fill before an early-start grace could ever race it", () => {
    expect(MOCK_CONFIG.earlyStartGraceSeconds).toBeLessThan(MOCK_CONFIG.fillWindowSeconds);
  });

  it("keeps the ticker-lane ceilings positive", () => {
    expect(MOCK_CONFIG.maxMockStartsPerTick).toBeGreaterThan(0);
    expect(MOCK_CONFIG.maxBotPicksPerTick).toBeGreaterThan(0);
    expect(MOCK_CONFIG.sweepIntervalMs).toBeGreaterThan(0);
  });

  it("bounds the lobby read to a shorter list than the real browse page's own cap", () => {
    expect(MOCK_CONFIG.maxLobbyListing).toBeGreaterThan(0);
    expect(MOCK_CONFIG.maxLobbyListing).toBeLessThan(MATCHMAKING_CONFIG.maxResults);
  });

  it("keeps every mock route's rate limit positive, and the write ceilings tighter than the shared read ceiling", () => {
    const { create, claim, read } = MOCK_CONFIG.rateLimit;
    for (const limit of [create, claim, read]) {
      expect(limit.maxRequests).toBeGreaterThan(0);
      expect(limit.windowMs).toBeGreaterThan(0);
    }
    expect(create.maxRequests).toBeLessThanOrEqual(read.maxRequests);
    expect(claim.maxRequests).toBeLessThanOrEqual(read.maxRequests);
  });

  it("budgets at least one bot pick for every expiry-scan slot, so the ceiling stays slack by arithmetic (Task 6 fix round)", () => {
    // The driver lands at most ONE pick per draft per tick, and the expiry scan hands it at
    // most `maxDraftsPerTick` drafts — so as long as this pin holds, the tick-wide bot budget
    // can never starve a mock mid-tick in ordinary operation. The same arithmetic-pin idiom as
    // the botDelay-inside-the-fastest-clock bound above: the config carries the guarantee, the
    // test keeps a future retune honest.
    expect(MOCK_CONFIG.maxBotPicksPerTick).toBeGreaterThanOrEqual(DRAFT_SERVICE_CONFIG.maxDraftsPerTick);
  });

  it("keeps the strategy's reach depth and run-reaction window positive", () => {
    expect(MOCK_CONFIG.strategy.reachDepth).toBeGreaterThan(0);
    expect(MOCK_CONFIG.strategy.temperature).toBeGreaterThan(0);
    expect(MOCK_CONFIG.strategy.runReaction.window).toBeGreaterThan(0);
    expect(MOCK_CONFIG.strategy.runReaction.threshold).toBeLessThanOrEqual(MOCK_CONFIG.strategy.runReaction.window);
  });

  it("keeps the need and run tuning sane: need warms, surplus damps below neutral, the follower's boost outruns the room's", () => {
    const { needPerOpenStartingSlot, startersFilledDamp, runReaction } = MOCK_CONFIG.strategy;
    expect(needPerOpenStartingSlot).toBeGreaterThan(0);
    expect(startersFilledDamp).toBeGreaterThan(0);
    expect(startersFilledDamp).toBeLessThan(1);
    expect(runReaction.baseBoost).toBeGreaterThan(1);
    expect(runReaction.needBoost).toBeGreaterThan(runReaction.baseBoost);
  });
});

describe("MOCK_BOT_TEAM_NAME_POOL", () => {
  it("holds at least as many names as the widest room needs, so a full room never runs the pool dry", () => {
    expect(MOCK_BOT_TEAM_NAME_POOL.length).toBeGreaterThanOrEqual(Math.max(...MOCK_CONFIG.teamCountOptions));
    expect(MOCK_BOT_TEAM_NAME_POOL.length).toBeGreaterThanOrEqual(20);
  });

  it("gives every team name a distinct, non-empty entry", () => {
    expect(new Set(MOCK_BOT_TEAM_NAME_POOL).size).toBe(MOCK_BOT_TEAM_NAME_POOL.length);
    for (const name of MOCK_BOT_TEAM_NAME_POOL) {
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("never spells out \"bot\"/\"AI\" or leaks strategy vocabulary either", () => {
    for (const name of MOCK_BOT_TEAM_NAME_POOL) {
      expect(nameViolations(name), `team name "${name}"`).toEqual([]);
    }
  });
});

describe("MOCK_COPY", () => {
  it("breaks none of the house copy rules — no dash, nothing accusatory or passive, no contraction, no forbidden vocabulary", () => {
    for (const [key, value] of Object.entries(MOCK_COPY)) {
      expect(copyViolations(value), `MOCK_COPY.${key} = ${JSON.stringify(value)}`).toEqual([]);
    }
  });

  it("never claims the bot is anything but a named, seeded opponent", () => {
    expect(MOCK_COPY.botMarkerLabel.toLowerCase()).not.toContain("ai");
    expect(MOCK_COPY.botBadge).toBe("Bot");
  });

  it("never leaves an empty lobby without an action", () => {
    expect(MOCK_COPY.lobbyEmptyActionLabel.length).toBeGreaterThan(0);
  });

  /** Task 8: the results page's own three actions, and its retention line kept honest against
   *  the config number it describes — the same "state the config, then pin the sentence
   *  against it" idiom the `MOCK_CONFIG.retention` test above already uses. */
  it("never leaves a finished results page without its three next actions", () => {
    expect(MOCK_COPY.resultsRunAgainLabel.length).toBeGreaterThan(0);
    expect(MOCK_COPY.resultsOpenLobbyLabel.length).toBeGreaterThan(0);
    expect(MOCK_COPY.resultsBrowseLeaguesLabel.length).toBeGreaterThan(0);
  });

  it("states the same retention window in its results sentence that MOCK_CONFIG actually enforces", () => {
    expect(MOCK_CONFIG.retention.completedMs).toBe(24 * 60 * 60 * 1000);
    expect(MOCK_COPY.resultsRetentionSentence).toContain("24 hours");
  });
});
