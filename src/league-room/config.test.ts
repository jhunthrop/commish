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
      // `heatMinPopulation` LEFT THIS CONFIG on 2026-08-28 and is now `UI_CONFIG.stat
      // .minPopulation` (`@/components/ui/config`), moved with the arithmetic it governs when
      // `Table` learned to judge a column. A draft-room table asking a league-room config how
      // many numbers make a population was the wrong shape, and a second copy of the four would
      // have been worse. Named here so this list reads as a deletion with a destination rather
      // than as a tunable somebody dropped.
    ];
    // `mockTableStorageKey` is the one non-numeric tunable (a storage address, not a quantity)
    // — listed by name so the exact-keys assertion still catches an unreviewed addition.
    expect(Object.keys(LEAGUE_ROOM_CONFIG).sort()).toEqual([...keys, "mockTableStorageKey"].sort());
    for (const key of keys) {
      expect(Number.isFinite(LEAGUE_ROOM_CONFIG[key])).toBe(true);
      expect(LEAGUE_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
    expect(LEAGUE_ROOM_CONFIG.mockTableStorageKey.length).toBeGreaterThan(0);
  });

  it("pins the attention queue's cap at the founder-ruled three", () => {
    // LED-1 (founder delegated-decision directive, 2026-08-24): three chips is the RULED value,
    // not a tunable — the veteran's under-a-second glance was the deciding persona. Changing it
    // is relitigating a ruling, and this assertion is what makes that a decision, not a drift.
    expect(LEAGUE_ROOM_CONFIG.attentionQueueCap).toBe(3);
  });
});
