import { describe, it, expect } from "vitest";
import { LEAGUE_ROOM_CONFIG } from "./config";

describe("LEAGUE_ROOM_CONFIG", () => {
  it("defines every tunable as a positive number", () => {
    const keys: readonly (keyof typeof LEAGUE_ROOM_CONFIG)[] = [
      "celebrationMs",
      "homeRefreshIntervalMs",
      "expiryTickMs",
      "attentionQueueCap",
      "mockLobbyPollIntervalMs",
      "mockHistoryVisibleCount",
    ];
    expect(Object.keys(LEAGUE_ROOM_CONFIG).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(Number.isFinite(LEAGUE_ROOM_CONFIG[key])).toBe(true);
      expect(LEAGUE_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
  });

  it("pins the attention queue's cap at the founder-ruled three", () => {
    // LED-1 (founder delegated-decision directive, 2026-08-24): three chips is the RULED value,
    // not a tunable — the veteran's under-a-second glance was the deciding persona. Changing it
    // is relitigating a ruling, and this assertion is what makes that a decision, not a drift.
    expect(LEAGUE_ROOM_CONFIG.attentionQueueCap).toBe(3);
  });
});
