import { describe, it, expect } from "vitest";
import { LEAGUE_ROOM_CONFIG } from "./config";

describe("LEAGUE_ROOM_CONFIG", () => {
  it("defines every tunable as a positive number", () => {
    const keys: readonly (keyof typeof LEAGUE_ROOM_CONFIG)[] = ["celebrationMs", "homeRefreshIntervalMs"];
    expect(Object.keys(LEAGUE_ROOM_CONFIG).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(Number.isFinite(LEAGUE_ROOM_CONFIG[key])).toBe(true);
      expect(LEAGUE_ROOM_CONFIG[key]).toBeGreaterThan(0);
    }
  });
});
