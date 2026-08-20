import { beforeEach, describe, expect, it } from "vitest";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { createAuditLogger, type AuditLogger } from "./audit-logger";
import { listLeagueActivity } from "./activity";

const db = createTestDb();

/** One `AuditLogger` per chain scope this file seeds, each minting its own prefixed ids, so a
 *  test can assert "every row came from league_1's chain" by checking the id prefix alone. */
function loggerFor(prefix: string): AuditLogger {
  let n = 0;
  return createAuditLogger({ newId: () => `evt_${prefix}_${(n += 1)}` });
}

let league1Logger: AuditLogger;
let league2Logger: AuditLogger;

function pickInput(n: number, leagueId: string): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: "user_bob",
    actorType: "user",
    leagueId,
    payload: { draftId: "d", teamId: "team_1", playerId: `player_${n}`, position: "RB", round: 1, pickNumber: n, slot: "RB", slotIndex: 0, price: null, auto: false },
    occurredAt: new Date(Date.UTC(2026, 7, 20, 17, 0, n)).toISOString(),
  };
}

async function seedPicks(logger: AuditLogger, leagueId: string, count: number): Promise<void> {
  for (let n = 1; n <= count; n += 1) await db.transaction((tx) => logger.record(tx, pickInput(n, leagueId)));
}

async function seedLineupChangeBy(actorId: string): Promise<void> {
  await db.transaction((tx) =>
    league1Logger.record(tx, {
      eventType: "lineup_change",
      actorId,
      actorType: "user",
      leagueId: "league_1",
      payload: { teamId: "team_1", weekNumber: 3, starters: [{ slot: "RB", slotIndex: 0, playerId: "player_secret" }] },
      occurredAt: "2026-08-20T18:00:00.000Z",
    }),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  league1Logger = loggerFor("l1");
  league2Logger = loggerFor("l2");
});

describe("listLeagueActivity", () => {
  it("reads one league's chain and never another's", async () => {
    await seedPicks(league1Logger, "league_1", 3);
    await seedPicks(league2Logger, "league_2", 3);

    const page = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.eventId.startsWith("evt_l1_"))).toBe(true);
  });

  it("returns newest first and pages by sequence", async () => {
    await seedPicks(league1Logger, "league_1", INTEGRITY_CONFIG.activity.pageSize + 5);

    const first = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
    expect(first.rows).toHaveLength(INTEGRITY_CONFIG.activity.pageSize);
    expect(first.rows[0]!.eventId).toBe(`evt_l1_${INTEGRITY_CONFIG.activity.pageSize + 5}`);

    const second = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob", before: first.nextBefore! });
    expect(second.rows[0]!.eventId).not.toBe(first.rows.at(-1)!.eventId);
    expect(second.rows).toHaveLength(5);
  });

  it("resolves names in a bounded number of queries however many rows it renders", async () => {
    // The N+1 this would otherwise be: one lookup per row for the actor and one for the player.
    await seedPicks(league1Logger, "league_1", 10);
    const { db: counted, selectCount } = countingDb(db);
    const before = selectCount();
    await listLeagueActivity(counted, { leagueId: "league_1", viewerUserId: "user_bob" });
    expect(selectCount() - before).toBeLessThanOrEqual(4);
  });

  it("omits a hidden row entirely rather than sending it and hiding it in the browser", async () => {
    await seedLineupChangeBy("user_alice");
    const page = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
    expect(JSON.stringify(page)).not.toContain("player_secret");
  });

  it("shows a member their own lineup change even though a stranger's is hidden", async () => {
    await seedLineupChangeBy("user_bob");
    const page = await listLeagueActivity(db, { leagueId: "league_1", viewerUserId: "user_bob" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ headline: "You set your week 3 lineup." });
  });

  it("returns an empty page, with no nextBefore, for a league with no chain at all", async () => {
    const page = await listLeagueActivity(db, { leagueId: "league_never_written", viewerUserId: "user_bob" });
    expect(page).toEqual({ rows: [], nextBefore: null });
  });
});
