import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players } from "@/db/schema";
import type { ApiEnvelope } from "@/lib/api/respond";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { PlayerHistoryBody } from "@/draft-room/contract";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { STAT_LINE_SOURCE, statMetricName } from "@/projections/lines";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { GET as getHistory } from "@/app/api/drafts/[draftId]/players/[playerId]/history/route";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const DRAFT_ID = "draft_history_api";
const LEAGUE_ID = "league_history_api";

/** The two seasons the card will find, against the REAL product-season constant. */
const LAST = PRODUCT_SEASON - 1;
const PRIOR = PRODUCT_SEASON - 2;

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

const get = (playerId: string) =>
  getHistory(new Request(`http://test/api/drafts/${DRAFT_ID}/players/${playerId}/history`), {
    params: Promise.resolve({ draftId: DRAFT_ID, playerId }),
  });

/** One stored fantasy week, spelled as the nflverse weekly file writes it into the store. */
function week(gsisId: string, season: number, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season,
    week: weekNumber,
    playerId: gsisId,
    source: STAT_LINE_SOURCE,
    metric: statMetricName(field),
    value,
    asOf,
  }));
}

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID,
    leagueId: LEAGUE_ID,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "rb_vet", name: "Vet Back", position: "RB", nflTeam: "DET" },
    { id: "rb_rookie", name: "Rookie Back", position: "RB", nflTeam: "ATL" },
  ]);
  // The historical universe: the vet, and one peer who out-scores him in the LAST season.
  await db.insert(nflPlayers).values([
    { id: "00-vet", pfrId: "VetBa00", name: "Vet Back", position: "RB", latestTeam: "DET", rookieSeason: PRIOR - 2, lastSeason: LAST },
    { id: "00-peer", pfrId: "PeerB00", name: "Peer Back", position: "RB", latestTeam: "SF", rookieSeason: PRIOR - 2, lastSeason: LAST },
  ]);
  const resolvedAt = new Date("2026-09-01T00:00:00.000Z");
  await db.insert(playerCrosswalk).values([
    { playerId: "rb_vet", nflPlayerId: "00-vet", method: "espn_id", resolvedAt },
    { playerId: "rb_rookie", nflPlayerId: null, unmatchedReason: "no_espn_id", resolvedAt },
  ]);
  // LAST season: the vet plays two weeks (a 100-yard TD game and a quiet one), the peer plays
  // one monster week and finishes above him. PRIOR season: only the vet has stored weeks.
  await recordObservations(db, [
    ...week("00-vet", LAST, 1, { rushingYards: 100, rushingTouchdowns: 1, receptions: 2, receivingYards: 20 }),
    ...week("00-vet", LAST, 2, { rushingYards: 40 }),
    ...week("00-peer", LAST, 1, { rushingYards: 200, rushingTouchdowns: 3 }),
    ...week("00-vet", PRIOR, 5, { rushingYards: 80, receivingYards: 30, receivingTouchdowns: 1 }),
  ]);
  return f;
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/drafts/[draftId]/players/[playerId]/history", () => {
  it("refuses a stranger the way every draft read does", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await get("rb_vet");
    expect(response.status).toBe(403);
  });

  it("summarizes the stored seasons under the league's own scoring, latest first, with the honest finish", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const body = (await (await get("rb_vet")).json()) as ApiEnvelope<PlayerHistoryBody>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.seasons.map((row) => row.season)).toEqual([LAST, PRIOR]);
    const [last, prior] = body.data.seasons;
    // LAST: two stored weeks. PPR scoring (no league settings row seeded): week 1 is
    // 100*0.1 + 6 + 2*1 + 20*0.1 = 20, week 2 is 4. The peer's 38-point week outranks the
    // vet's 24, so the vet finishes RB2 among players with a stored week.
    expect(last).toEqual({ season: LAST, gamesPlayed: 2, pointsPerGame: 12, totalYards: 160, totalTouchdowns: 1, positionFinish: "RB2" });
    // PRIOR: one stored week (80*0.1 + 30*0.1 + 6 = 17), no peer stored at all — RB1 of a
    // one-man population.
    expect(prior).toEqual({ season: PRIOR, gamesPlayed: 1, pointsPerGame: 17, totalYards: 110, totalTouchdowns: 1, positionFinish: "RB1" });

    // The consistency strip: the most recent listed season's own weeks, ascending.
    expect(body.data.latestWeeklySeason).toBe(LAST);
    expect(body.data.latestWeekly).toEqual([
      { week: 1, points: 20 },
      { week: 2, points: 4 },
    ]);
  });

  it("answers a player the stores cannot place with emptiness, never an error or a placeholder", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const body = (await (await get("rb_rookie")).json()) as ApiEnvelope<PlayerHistoryBody>;
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    expect(body.data).toEqual({ seasons: [], latestWeeklySeason: null, latestWeekly: [] });
  });
});
