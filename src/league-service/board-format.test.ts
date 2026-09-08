import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, scoringSettings, users } from "@/db/schema";
import { HALF_PPR_SCORING, STANDARD_SCORING } from "@/domain/scoring";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { boardFormatResolution, leagueBoardFormat } from "./board-format";

describe("leagueBoardFormat", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "Commish" });
  });

  async function seedLeague(id: string, rules: typeof HALF_PPR_SCORING | null): Promise<void> {
    await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 12, commissionerUserId: "u1" });
    if (rules !== null) await db.insert(scoringSettings).values({ leagueId: id, ...rules });
  }

  it("a half-PPR league reads the half board, exactly, with no note", async () => {
    await seedLeague("half-league", HALF_PPR_SCORING);
    const resolved = await leagueBoardFormat(db, "half-league");
    expect(resolved).toMatchObject({ format: "half", exact: true, note: null, source: "commish_board_v9_half_12", label: "Half PPR" });
    expect(resolved.basisLine).toBe(`${PRODUCT_SEASON} board, 12-team half PPR, in board order`);
  });

  it("a league with no scoring row falls back to PPR, the same fallback every other reader makes", async () => {
    await seedLeague("bare-league", null);
    const resolved = await leagueBoardFormat(db, "bare-league");
    expect(resolved.format).toBe("ppr");
    expect(resolved.source).toBe(BOARD_SOURCE);
  });

  it("a custom sheet reads the nearest board and carries the note for the basis line", async () => {
    await seedLeague("custom-league", { ...STANDARD_SCORING, pointsPerReception: 0.2 });
    const resolved = await leagueBoardFormat(db, "custom-league");
    expect(resolved.format).toBe("std");
    expect(resolved.exact).toBe(false);
    expect(resolved.note).toContain("Standard");
  });
});

describe("boardFormatResolution", () => {
  it("names a directly chosen format as exact, with its own source and basis line", () => {
    expect(boardFormatResolution("std", 2026)).toMatchObject({
      format: "std",
      exact: true,
      note: null,
      source: "commish_board_v9_std_12",
      basisLine: "2026 board, 12-team standard scoring, in board order",
    });
  });
});
