import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { NflverseClient } from "./client";
import { ingestCoaches } from "./ingest";

/**
 * `ingestCoaches` reads the play-caller table from the `coaches` table now, never from disk, and
 * an empty table is the one absence it must not paper over: with no rows the coach observations
 * would silently fall back to head-coach-only for every team-season, which is the exact case the
 * table exists to handle. So it fails before it fetches anything.
 */
const db = createTestDb();

const NOT_BEFORE_THE_TABLE = "the schedule must not be fetched before the coaches table is checked";
const neverFetches: NflverseClient = {
  getCsv: () => Promise.reject(new Error(NOT_BEFORE_THE_TABLE)),
  streamCsv: () => Promise.reject(new Error(NOT_BEFORE_THE_TABLE)),
};

describe("ingestCoaches", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("refuses an empty coaches table, naming the ingest to run, before reaching the network", async () => {
    await expect(ingestCoaches(db, [2025], neverFetches)).rejects.toThrow(/coaches:ingest/);
  });
});
