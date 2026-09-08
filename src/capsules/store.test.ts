import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { players } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { CapsuleGenerationResult } from "./generate";
import { getPlayerCapsule, getStoredCapsule, upsertCapsule } from "./store";

function llmResult(overrides: Partial<CapsuleGenerationResult> = {}): CapsuleGenerationResult {
  return {
    compact: { text: "Compact body.", source: "llm", usage: null, fallbackReason: null },
    full: { text: "Full body.", source: "llm", usage: null, fallbackReason: null },
    narrative: { slots: {}, model: null, rejected: [], failure: null },
    source: "llm",
    model: "zai/glm-5.3-flash",
    usage: null,
    ...overrides,
  };
}

describe("capsule store", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(players).values({ id: "p1", name: "Rashad Long", position: "RB", nflTeam: "SF" });
  });

  it("returns null for a player the sweep has never reached", async () => {
    expect(await getStoredCapsule(db, "p1")).toBeNull();
    expect(await getPlayerCapsule(db, "p1")).toBeNull();
  });

  it("stores and reads back a fresh llm capsule", async () => {
    await upsertCapsule(db, "p1", "hash-1", llmResult());
    const stored = await getStoredCapsule(db, "p1");
    expect(stored).toMatchObject({ playerId: "p1", factsHash: "hash-1", bodyCompact: "Compact body.", bodyFull: "Full body.", source: "llm", model: "zai/glm-5.3-flash" });

    const view = await getPlayerCapsule(db, "p1");
    expect(view).toEqual({ bodyCompact: "Compact body.", bodyFull: "Full body.", source: "llm", narrative: null });
  });

  it("stores a template-sourced capsule with a null model", async () => {
    await upsertCapsule(db, "p1", "hash-1", llmResult({ source: "template", model: null, compact: { text: "Template compact.", source: "template", usage: null, fallbackReason: { kind: "throttled" } } }));
    const stored = await getStoredCapsule(db, "p1");
    expect(stored?.source).toBe("template");
    expect(stored?.model).toBeNull();
  });

  it("upserts in place on a second write, never creating a second row", async () => {
    await upsertCapsule(db, "p1", "hash-1", llmResult());
    await upsertCapsule(db, "p1", "hash-2", llmResult({ compact: { text: "Updated compact.", source: "llm", usage: null, fallbackReason: null } }));
    const stored = await getStoredCapsule(db, "p1");
    expect(stored?.factsHash).toBe("hash-2");
    expect(stored?.bodyCompact).toBe("Updated compact.");
  });
});
