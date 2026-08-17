import { describe, it, expect } from "vitest";
import { requireLeagueMember } from "./membership";

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
    expect(await response!.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });

  it("accepts DraftActor's shape structurally — the same predicate, no adapter needed", () => {
    // DraftActor carries draftId/leagueId too; requireLeagueMember only reads teamId/isCommissioner.
    const draftActor = { draftId: "d1", leagueId: "l1", teamId: "team_1", isCommissioner: false };
    expect(requireLeagueMember(draftActor)).toBeNull();
  });
});
