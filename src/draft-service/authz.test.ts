import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import { resolveDraftActor } from "./authz";

/**
 * A `Db` stub whose `SELECT`s answer by table — the only way to put `resolveDraftActor` in a
 * state real Postgres cannot produce: a draft naming a league that `resolveLeagueMembership`
 * cannot find, even though `drafts.leagueId` is a NOT NULL foreign key.
 */
function stubDbAnswering(answers: { readonly draftLeagueId?: string; readonly leagueFound?: boolean }): Db {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === drafts) return answers.draftLeagueId === undefined ? [] : [{ leagueId: answers.draftLeagueId }];
          if (table === leagues) return answers.leagueFound === false ? [] : [{ commissionerUserId: "u_other", houseRung: null }];
          return []; // teams: no team for this user
        },
      }),
    }),
  } as unknown as Db;
}

describe("resolveDraftActor", () => {
  it("404s when the draft itself doesn't exist", async () => {
    const result = await resolveDraftActor(stubDbAnswering({}), "draft_ghost", "u_1");
    expect(result).toEqual({ ok: false, status: 404, error: "That draft does not exist." });
  });

  it("resolves a real caller's draft actor from the draft id and user id alone", async () => {
    const result = await resolveDraftActor(stubDbAnswering({ draftLeagueId: "league_1" }), "draft_1", "u_1");
    expect(result).toEqual({
      ok: true,
      actor: { draftId: "draft_1", leagueId: "league_1", userId: "u_1", teamId: null, isCommissioner: false },
    });
  });

  it("surfaces the draft's own 404 rather than the league's, on the structurally-impossible case of a draft naming a league resolveLeagueMembership cannot find", async () => {
    // `drafts.leagueId` is a NOT NULL foreign key — this branch cannot happen through real
    // Postgres — but the type still allows it, and this proves the fallback stays scoped to
    // what the caller actually asked about (the draft) rather than leaking the league's error.
    const result = await resolveDraftActor(stubDbAnswering({ draftLeagueId: "league_ghost", leagueFound: false }), "draft_1", "u_1");
    expect(result).toEqual({ ok: false, status: 404, error: "That draft does not exist." });
  });
});
