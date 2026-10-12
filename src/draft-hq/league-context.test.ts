import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { draftDoorFor, nextDraftingLeague } from "./league-context";

/**
 * WHICH DRAFT IS STILL A DOOR (fix round 1, H1).
 *
 * Two nearly-identical selects had drifted apart: the board's own league default carried
 * `kickoff_at >= now` and the quiet line above it did not, so a scheduled draft whose kickoff had
 * passed without ever starting was still offered as a room to open — "drafts Thursday" about a
 * Thursday already gone — while the basis three inches below it named a different league. Both
 * read one query now, and these are the cases that keep it that way.
 *
 * DB-backed rather than mocked: the guard is a comparison over a real timestamp column joined
 * through two tables, and a mock would only prove the mock agrees with itself.
 */
describe("the Draft area's league context", () => {
  let db: Db;
  const USER = "user-door";
  const NOW = new Date("2026-09-12T18:00:00.000Z");

  async function seedLeague(input: { readonly id: string; readonly name: string; readonly kickoffAt: Date; readonly status: "scheduled" | "in_progress" | "complete" }): Promise<void> {
    await db.insert(leagues).values({ id: input.id, name: input.name, format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: USER });
    await db.insert(teams).values({ id: `team-${input.id}`, leagueId: input.id, userId: USER, name: "My team" });
    await db.insert(drafts).values({ id: `draft-${input.id}`, leagueId: input.id, format: "snake", status: input.status, kickoffAt: input.kickoffAt });
  }

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values({ id: USER, displayName: "Door", email: "door@example.com" });
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  it("is no door at all when a scheduled kickoff has passed and the draft never started", async () => {
    await seedLeague({ id: "stale", name: "Stale League", kickoffAt: new Date("2026-09-10T18:00:00.000Z"), status: "scheduled" });

    expect(await draftDoorFor(db, USER, undefined, NOW)).toBeNull();
    expect(await nextDraftingLeague(db, USER, NOW)).toBeNull();
  });

  it("opens the room for a draft under way, whatever its kickoff says", async () => {
    await seedLeague({ id: "live", name: "Live League", kickoffAt: new Date("2026-09-11T18:00:00.000Z"), status: "in_progress" });

    const door = await draftDoorFor(db, USER, undefined, NOW);
    expect(door).toMatchObject({ leagueId: "live", draftId: "draft-live", drafting: true });
    // A draft already half run is never the BOARD's context: the board would be computed under a
    // league whose pool is gone.
    expect(await nextDraftingLeague(db, USER, NOW)).toBeNull();
  });

  it("puts a draft under way ahead of one still to come", async () => {
    await seedLeague({ id: "soon", name: "Soon League", kickoffAt: new Date("2026-09-12T19:00:00.000Z"), status: "scheduled" });
    await seedLeague({ id: "live", name: "Live League", kickoffAt: new Date("2026-09-11T18:00:00.000Z"), status: "in_progress" });

    expect(await draftDoorFor(db, USER, undefined, NOW)).toMatchObject({ leagueId: "live", drafting: true });
    expect(await nextDraftingLeague(db, USER, NOW)).toMatchObject({ leagueId: "soon" });
  });

  it("names the league the page is about when nothing is drafting, never a different one", async () => {
    await seedLeague({ id: "soonest", name: "Soonest League", kickoffAt: new Date("2026-09-12T19:00:00.000Z"), status: "scheduled" });
    await seedLeague({ id: "later", name: "Later League", kickoffAt: new Date("2026-09-14T19:00:00.000Z"), status: "scheduled" });

    // The line and the basis under it agree: the page's own context wins its own line.
    expect(await draftDoorFor(db, USER, "later", NOW)).toMatchObject({ leagueId: "later", drafting: false });
    // With no context to prefer, the soonest is the honest default — and it is the same row the
    // board's own picker default resolves to.
    expect(await draftDoorFor(db, USER, undefined, NOW)).toMatchObject({ leagueId: "soonest" });
    expect(await nextDraftingLeague(db, USER, NOW)).toMatchObject({ leagueId: "soonest" });
  });

  it("ignores a draft that is already over", async () => {
    await seedLeague({ id: "done", name: "Done League", kickoffAt: new Date("2026-09-01T18:00:00.000Z"), status: "complete" });

    expect(await draftDoorFor(db, USER, undefined, NOW)).toBeNull();
  });
});
