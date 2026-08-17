import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDataset, DATASET_SEED, PLAYER_COUNT, SEASON_WEEKS } from "./generate-dataset";

describe("generateDataset", () => {
  const ds = generateDataset(DATASET_SEED);

  it("produces exactly PLAYER_COUNT players with unique ids and valid positions", () => {
    expect(ds.players).toHaveLength(PLAYER_COUNT);
    expect(new Set(ds.players.map((p) => p.id)).size).toBe(PLAYER_COUNT);
    for (const p of ds.players) expect(["QB", "RB", "WR", "TE", "K", "DEF"]).toContain(p.position);
  });

  it("produces one stat line per player per week for SEASON_WEEKS weeks", () => {
    expect(ds.statLines).toHaveLength(PLAYER_COUNT * SEASON_WEEKS);
    const weeks = new Set(ds.statLines.map((s) => s.week));
    expect([...weeks].sort((a, b) => a - b)).toEqual(Array.from({ length: SEASON_WEEKS }, (_, i) => i + 1));
  });

  it("is deterministic: same seed → deep-equal output; different seed → different output", () => {
    expect(generateDataset(DATASET_SEED)).toEqual(ds);
    expect(generateDataset(DATASET_SEED + 1)).not.toEqual(ds);
  });

  it("gives position-appropriate stats (a K never has passing yards; a QB never kicks)", () => {
    const byId = new Map(ds.players.map((p) => [p.id, p]));
    for (const s of ds.statLines) {
      const pos = byId.get(s.playerId)!.position;
      if (pos === "K") { expect(s.passingYards).toBe(0); expect(s.receptions).toBe(0); }
      if (pos === "QB") { expect(s.fieldGoalsMade).toBe(0); expect(s.sacks).toBe(0); }
      if (pos !== "DEF") { expect(s.sacks).toBe(0); expect(s.defensiveInterceptions).toBe(0); }
    }
  });

  it("never gives a DEF an all-zero defensive line (a defense that plays always registers something)", () => {
    const byId = new Map(ds.players.map((p) => [p.id, p]));
    for (const s of ds.statLines) {
      if (byId.get(s.playerId)!.position !== "DEF") continue;
      expect(s.sacks + s.defensiveInterceptions + s.defensiveTouchdowns).toBeGreaterThan(0);
    }
  });

  it("matches the committed dataset.json byte-for-byte (run `npm run stats:generate` after changing the generator)", () => {
    const committed = readFileSync(resolve(process.cwd(), "src/stats/mock/dataset.json"), "utf8");
    expect(committed).toBe(JSON.stringify(ds, null, 2) + "\n");
  });
});
