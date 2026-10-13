import { beforeEach, describe, expect, it } from "vitest";
import { coachingFor } from "@research-ts/capsules/facts/coaching";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { BOARD_MEMO_GROUP, invalidateTtlMemoGroup } from "@research-ts/lib/cache/ttl-memo";
import type { PlayCallerRow } from "@research-ts/projections/nflverse/play-callers";
import { coachRows, readCoachRows, upsertCoachRows } from "./store";

/**
 * The repository over a REAL table: what goes in comes back in the shape every reader already
 * consumes (`PlayCallerRow`), a re-ingest updates in place rather than duplicating, the memo
 * serves one read per instance until the board group is cleared, and an empty table is an
 * honest absence rather than an error.
 */
const db = createTestDb();

function row(overrides: Partial<PlayCallerRow> & Pick<PlayCallerRow, "season" | "team" | "name">): PlayCallerRow {
  return { role: "OC", startWeek: 1, endWeek: 18, source: "wikipedia", note: "", headCoach: "", headCoachFirstSeason: null, ...overrides };
}

const DETROIT_2025 = row({ season: 2025, team: "DET", name: "Ben Johnson", note: "left for CHI" });
const DETROIT_2026 = row({ season: 2026, team: "DET", name: "John Morton", headCoach: "Dan Campbell", headCoachFirstSeason: 2021 });
const RAMS_2026 = row({ season: 2026, team: "LA", name: "Sean McVay", role: "HC", source: "both" });

describe("coaches store", () => {
  beforeEach(async () => {
    await truncateAll(db);
  });

  it("reads back exactly the rows written, in season, team, week order, with a blank head coach as the empty string", async () => {
    await upsertCoachRows(db, [RAMS_2026, DETROIT_2026, DETROIT_2025]);
    expect(await readCoachRows(db)).toEqual([DETROIT_2025, DETROIT_2026, RAMS_2026]);
  });

  it("updates a tenure in place on its natural key rather than duplicating it", async () => {
    expect(await upsertCoachRows(db, [DETROIT_2026])).toBe(1);
    expect(await upsertCoachRows(db, [{ ...DETROIT_2026, name: "John Morton (corrected)", headCoach: "", headCoachFirstSeason: null }])).toBe(1);
    const rows = await readCoachRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "John Morton (corrected)", headCoach: "", headCoachFirstSeason: null });
  });

  it("writes nothing and reports zero for an empty batch", async () => {
    expect(await upsertCoachRows(db, [])).toBe(0);
    expect(await readCoachRows(db)).toEqual([]);
  });

  it("serves one read per instance and sees a re-ingest only after the board group is cleared", async () => {
    await upsertCoachRows(db, [DETROIT_2025]);
    const first = await coachRows(db);
    expect(first).toEqual([DETROIT_2025]);
    await upsertCoachRows(db, [DETROIT_2026]);
    expect(await coachRows(db)).toBe(first);
    invalidateTtlMemoGroup(BOARD_MEMO_GROUP);
    expect(await coachRows(db)).toEqual([DETROIT_2025, DETROIT_2026]);
  });

  it("renders a season the table does not hold as absence through the coaches fact", async () => {
    await upsertCoachRows(db, [DETROIT_2025, DETROIT_2026]);
    const rows = await coachRows(db);
    expect(coachingFor("DET", 2026, rows)).toEqual({
      season: 2026,
      headCoach: "Dan Campbell",
      headCoachIsNew: false,
      playCaller: "John Morton",
      playCallerRole: "OC",
      playCallerIsNew: true,
    });
    expect(coachingFor("DET", 2025, rows)).toMatchObject({ headCoach: null, headCoachIsNew: null, playCaller: "Ben Johnson", playCallerIsNew: null });
    expect(coachingFor("DET", 2024, rows)).toBeNull();
  });
});
