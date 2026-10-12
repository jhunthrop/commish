import { describe, expect, it } from "vitest";
import type { StatLine } from "@research/domain/player";
import { diffStatLines, statLineDigest } from "./digest";

const line = (playerId: string, over: Partial<StatLine> = {}): StatLine => ({
  playerId, week: 3, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
  rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
  fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
  ...over,
});

describe("statLineDigest", () => {
  it("is stable for the same numbers", () => {
    expect(statLineDigest(line("p1", { rushingYards: 40 }))).toBe(statLineDigest(line("p1", { rushingYards: 40 })));
  });

  it("moves when any single stat field moves", () => {
    const base = statLineDigest(line("p1"));
    // Every field, not a hand-picked two: a digest that silently omits one field is a whole
    // category of stat that can change all Sunday without anyone being told.
    for (const field of ["passingYards", "passingTouchdowns", "interceptions", "rushingYards",
      "rushingTouchdowns", "receivingYards", "receivingTouchdowns", "receptions", "fumblesLost",
      "fieldGoalsMade", "extraPointsMade", "sacks", "defensiveInterceptions", "defensiveTouchdowns"] as const) {
      expect(statLineDigest(line("p1", { [field]: 1 }))).not.toBe(base);
    }
  });

  it("distinguishes a half sack from a whole one", () => {
    // player_stat_lines.sacks is `real`, not `integer` (migration 0012). A digest that rounded
    // would call 1.5 and 1 the same line.
    expect(statLineDigest(line("p1", { sacks: 1.5 }))).not.toBe(statLineDigest(line("p1", { sacks: 1 })));
  });
});

describe("diffStatLines", () => {
  it("returns nothing changed when the week is identical", () => {
    const next = [line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 })];
    const previous = new Map(next.map((entry) => [entry.playerId, statLineDigest(entry)]));
    expect(diffStatLines(previous, next).changed).toEqual([]);
  });

  it("returns only the lines whose numbers moved", () => {
    const before = [line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 })];
    const previous = new Map(before.map((entry) => [entry.playerId, statLineDigest(entry)]));
    const after = [line("p1", { rushingYards: 62 }), line("p2", { receptions: 3 })];
    expect(diffStatLines(previous, after).changed.map((entry) => entry.playerId)).toEqual(["p1"]);
  });

  it("treats a player who has never been seen as changed", () => {
    expect(diffStatLines(new Map(), [line("p9")]).changed.map((entry) => entry.playerId)).toEqual(["p9"]);
  });

  it("hands back the digests for the whole incoming week, not only the changed ones", () => {
    // The returned map is what gets written back as the next tick's snapshot. Returning only the
    // changed digests would drop every unchanged player from the snapshot and make them all look
    // changed on the following tick, which is the same bug as having no diff at all.
    const next = [line("p1"), line("p2")];
    expect([...diffStatLines(new Map(), next).digests.keys()].sort()).toEqual(["p1", "p2"]);
  });

  it("never hands back the same playerId twice, even when the tick's lines carry it twice", () => {
    // `persistTick` inserts `changed` as one multi-row ON CONFLICT DO UPDATE, and Postgres
    // rejects the WHOLE statement with 21000 if a conflict key repeats — so one duplicated player
    // in a week's box scores used to fail the entire tick, every poll interval, until upstream
    // cleared it. Last line wins, which is the documented rule.
    const duplicated = [line("p1", { rushingYards: 40 }), line("p2"), line("p1", { rushingYards: 62 })];
    const { changed, digests } = diffStatLines(new Map(), duplicated);

    expect(changed.map((entry) => entry.playerId).sort()).toEqual(["p1", "p2"]);
    expect(changed.find((entry) => entry.playerId === "p1")!.rushingYards).toBe(62);
    expect(digests.get("p1")).toBe(statLineDigest(line("p1", { rushingYards: 62 })));
  });

  it("drops a player from `changed` when a later duplicate matches what is already stored", () => {
    // The other direction of last-wins: the first copy differs from the snapshot and the second
    // does not, so the tick has nothing to write for that player and must not claim it changed.
    const stored = line("p1", { rushingYards: 40 });
    const previous = new Map([[stored.playerId, statLineDigest(stored)]]);
    const { changed } = diffStatLines(previous, [line("p1", { rushingYards: 62 }), stored]);
    expect(changed).toEqual([]);
  });
});
