import { describe, expect, it } from "vitest";
import { reorderSchema, replaceEntriesSchema } from "./schemas";

function entries(count: number, playerIdOf: (index: number) => string = (index) => `p${index}`) {
  return Array.from({ length: count }, (_, index) => ({ playerId: playerIdOf(index) }));
}

describe("replaceEntriesSchema", () => {
  it("accepts a normal, deduplicated list", () => {
    const result = replaceEntriesSchema.safeParse({ entries: entries(3) });
    expect(result.success).toBe(true);
  });

  describe("fix round 1, HIGH 2 (belt-and-braces) — duplicate playerId rejected with a clean 400", () => {
    it("rejects a body naming the same player twice", () => {
      const result = replaceEntriesSchema.safeParse({ entries: [{ playerId: "p1" }, { playerId: "p2" }, { playerId: "p1" }] });
      expect(result.success).toBe(false);
      expect(result.success === false && result.error.issues[0]?.message).toBe("The same player cannot appear twice in one sheet.");
    });

    it("still rejects when the duplicate rows carry different tiers/notes/tags — identity is the playerId alone", () => {
      const result = replaceEntriesSchema.safeParse({
        entries: [
          { playerId: "p1", tag: "target" },
          { playerId: "p1", tag: "avoid", note: "different row entirely" },
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("fix round 1, MEDIUM 1 — bounded array", () => {
    it("accepts exactly the 500-entry ceiling", () => {
      expect(replaceEntriesSchema.safeParse({ entries: entries(500) }).success).toBe(true);
    });

    it("rejects 501 entries", () => {
      const result = replaceEntriesSchema.safeParse({ entries: entries(501) });
      expect(result.success).toBe(false);
      expect(result.success === false && result.error.issues[0]?.message).toBe("A sheet can hold at most 500 players.");
    });
  });
});

describe("reorderSchema", () => {
  it("accepts a normal order", () => {
    expect(reorderSchema.safeParse({ order: ["p1", "p2"] }).success).toBe(true);
  });

  describe("fix round 1, MEDIUM 1 — bounded array", () => {
    it("accepts exactly the 500-entry ceiling", () => {
      expect(reorderSchema.safeParse({ order: Array.from({ length: 500 }, (_, i) => `p${i}`) }).success).toBe(true);
    });

    it("rejects 501 entries", () => {
      const result = reorderSchema.safeParse({ order: Array.from({ length: 501 }, (_, i) => `p${i}`) });
      expect(result.success).toBe(false);
      expect(result.success === false && result.error.issues[0]?.message).toBe("A sheet can hold at most 500 players.");
    });
  });
});
