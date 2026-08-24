import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, teams, users } from "@/db/schema";
import { NO_TEAM_MESSAGE, requireLeagueMember, resolveLeagueMembership } from "./membership";

describe("requireLeagueMember", () => {
  it("lets a team-holding manager through", () => {
    expect(requireLeagueMember({ teamId: "team_1", isCommissioner: false })).toBeNull();
  });

  it("lets a commissioner with no team of their own through", () => {
    expect(requireLeagueMember({ teamId: null, isCommissioner: true })).toBeNull();
  });

  it("refuses a signed-in stranger — no team and not the commissioner — with the shared 403 message", async () => {
    const response = requireLeagueMember({ teamId: null, isCommissioner: false });
    expect(response).not.toBeNull();
    expect(response!.status).toBe(403);
    expect(await response!.json()).toEqual({ ok: false, error: "You do not have a team in this league." });
  });

  it("accepts DraftActor's shape structurally — the same predicate, no adapter needed", () => {
    // DraftActor carries draftId/leagueId too; requireLeagueMember only reads teamId/isCommissioner.
    const draftActor = { draftId: "d1", leagueId: "l1", teamId: "team_1", isCommissioner: false };
    expect(requireLeagueMember(draftActor)).toBeNull();
  });
});

describe("resolveLeagueMembership", () => {
  const db = createTestDb();

  beforeEach(async () => {
    await truncateAll(db);
  });

  async function seedMemberLeague(leagueId: string, commissionerUserId: string): Promise<void> {
    await db.insert(users).values({ id: commissionerUserId, email: `${commissionerUserId}@test.local`, displayName: commissionerUserId });
    await db.insert(leagues).values({ id: leagueId, name: leagueId, format: "snake", teamCount: 12, commissionerUserId });
    await db.insert(teams).values({ id: `${leagueId}_commish_team`, leagueId, userId: commissionerUserId, name: "Commissioner's Team" });
  }

  async function seedHouseLeague(leagueId: string): Promise<void> {
    await db.insert(leagues).values({ id: leagueId, name: leagueId, format: "snake", teamCount: 12, commissionerUserId: null, houseRung: "open_12" });
  }

  it("names the actual commissioner of a member league", async () => {
    await seedMemberLeague("lg_member", "u_commish");
    const result = await resolveLeagueMembership(db, "lg_member", "u_commish");
    expect(result).toMatchObject({ ok: true, membership: { isCommissioner: true, authority: { kind: "member", userId: "u_commish" } } });
  });

  it("lets a member of a house league in, and calls none of them commissioner", async () => {
    await seedHouseLeague("lg_house");
    await db.insert(users).values({ id: "u_member", email: "u_member@test.local", displayName: "u_member" });
    await db.insert(teams).values({ id: "team_house_member", leagueId: "lg_house", userId: "u_member", name: "House Team" });

    const result = await resolveLeagueMembership(db, "lg_house", "u_member");
    expect(result).toMatchObject({
      ok: true,
      membership: { teamId: expect.any(String), isCommissioner: false, authority: { kind: "house", rung: "open_12" } },
    });
  });

  it("keeps a stranger out of a house league exactly as it keeps them out of any other", async () => {
    // `requireLeagueMember` admits on `teamId !== null || isCommissioner`. In a house league the
    // second disjunct is false for everybody, so the rule collapses to "do you have a team", which
    // is the correct rule and is reached without a special case.
    await seedHouseLeague("lg_house_stranger");
    await db.insert(users).values({ id: "u_stranger", email: "u_stranger@test.local", displayName: "u_stranger" });

    const result = await resolveLeagueMembership(db, "lg_house_stranger", "u_stranger");
    expect(result.ok).toBe(true);
    const denial = requireLeagueMember(result.ok ? result.membership : { teamId: null, isCommissioner: false });
    expect(denial).not.toBeNull();
    expect(denial!.status).toBe(403);
    expect(await denial!.json()).toEqual({ ok: false, error: NO_TEAM_MESSAGE });
  });

  it("answers 404 for a league that doesn't exist", async () => {
    const result = await resolveLeagueMembership(db, "lg_does_not_exist", "u_anyone");
    expect(result).toEqual({ ok: false, status: 404, error: "That league does not exist." });
  });
});
