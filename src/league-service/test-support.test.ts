import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { advisorFixture, seasonThroughWeek, twoTeamLeague } from "./test-support";

/**
 * A `Db` whose `transaction(...)` always rejects, and whose every other method is a no-op —
 * this file's fixtures always seed valid input for `createLeague`, so its own failure path
 * (`twoTeamLeague`/`advisorFixture`/`seasonThroughWeek`'s `if (!created.ok) throw ...`) can only
 * be reached by making the transaction itself fail, never by a real validation rejection.
 */
function dbWhoseTransactionThrows(): Db {
  return {
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    transaction: () => Promise.reject(new Error("connection reset by peer")),
  } as unknown as Db;
}

describe("test-support fixtures' own failure path", () => {
  it("twoTeamLeague surfaces createLeague's own failure rather than seeding a half-built fixture", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(twoTeamLeague(dbWhoseTransactionThrows())).rejects.toThrow(
        "We could not create that league. Please try again.",
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("advisorFixture surfaces createLeague's own failure rather than seeding a half-built fixture", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(advisorFixture(dbWhoseTransactionThrows(), "ppr")).rejects.toThrow(
        "We could not create that league. Please try again.",
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it("seasonThroughWeek surfaces createLeague's own failure rather than seeding a half-built fixture", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(seasonThroughWeek(dbWhoseTransactionThrows(), { week: 3, settled: true, lineupsSaved: false })).rejects.toThrow(
        "We could not create that league. Please try again.",
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
