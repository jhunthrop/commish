import { describe, expect, it } from "vitest";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { copyViolations } from "@/integrity/copy-rules";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { MOCK_CONFIG, MOCK_COPY } from "./config";

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

  it("gives every bot a distinct, non-empty name", () => {
    const names = MOCK_CONFIG.botRoster.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
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
