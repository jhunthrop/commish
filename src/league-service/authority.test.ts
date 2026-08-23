import { describe, expect, it } from "vitest";
import { HOUSE_AUTHORITY_REFUSALS, isCommissionerOf, leagueAuthority } from "./authority";

describe("leagueAuthority", () => {
  it("names the member who commissions a member league", () => {
    expect(leagueAuthority({ commissionerUserId: "u_alice", houseRung: null })).toEqual({ kind: "member", userId: "u_alice" });
  });

  it("names the platform when a league came from the catalog", () => {
    expect(leagueAuthority({ commissionerUserId: null, houseRung: "open_12" })).toEqual({ kind: "house", rung: "open_12" });
  });

  it("refuses to answer for a row whose two columns disagree, rather than guessing", () => {
    // The CHECK constraint makes this unreachable from Postgres. It is asserted anyway, because a
    // unit test constructs the shape by hand and a future reader needs the invariant stated in
    // TypeScript as well as in DDL.
    expect(() => leagueAuthority({ commissionerUserId: "u_alice", houseRung: "open_12" })).toThrow(/house_rung/);
    expect(() => leagueAuthority({ commissionerUserId: null, houseRung: null })).toThrow(/commissioner/);
  });
});

describe("isCommissionerOf", () => {
  it("says yes only for the named member commissioner", () => {
    const member = { commissionerUserId: "u_alice", houseRung: null } as const;
    expect(isCommissionerOf(member, "u_alice")).toBe(true);
    expect(isCommissionerOf(member, "u_bob")).toBe(false);
  });

  it("gives nobody commissioner powers in a house league, including an operator", () => {
    // An operator's authority is `users.is_admin` and it reaches the admin surface, not this one.
    // A house league has no commissioner seat for anybody to occupy, which is the point of it.
    const house = { commissionerUserId: null, houseRung: "open_12" } as const;
    expect(isCommissionerOf(house, "u_alice")).toBe(false);
    expect(isCommissionerOf(house, "u_operator")).toBe(false);
  });
});

describe("HOUSE_AUTHORITY_REFUSALS", () => {
  it("names both doors a house league closes", () => {
    expect(Object.keys(HOUSE_AUTHORITY_REFUSALS)).toEqual(["invite", "schedule"]);
  });
});
