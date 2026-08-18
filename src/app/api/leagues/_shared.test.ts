import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/lib/leagues/membership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/leagues/membership")>();
  return { ...actual, resolveLeagueMembership: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { withCommissioner, withCurrentUser, withLeagueActor, withLeagueMemberActor } from "./_shared";

const params = Promise.resolve({ leagueId: "league_1" });
const context = { params };
const request = () => new Request("http://test/api/leagues/league_1/thing");

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z" },
  );

const membership = (teamId: string | null, isCommissioner: boolean) =>
  vi.mocked(resolveLeagueMembership).mockResolvedValue({ ok: true, membership: { leagueId: "league_1", teamId, isCommissioner } });

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(resolveLeagueMembership).mockReset();
});

describe("withCurrentUser", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    signedInAs(null);
    const response = await withCurrentUser(request(), async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("returns a generic 500 and never leaks the real exception text when the handler throws", async () => {
    signedInAs("u1");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await withCurrentUser(request(), async () => {
        throw new Error("raw exception text that must never reach the client");
      });
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ ok: false, error: "Something went wrong on our side. Please try again." });
      expect(JSON.stringify(body)).not.toContain("raw exception text");
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("withLeagueActor", () => {
  it("passes the resolved actor through to the handler", async () => {
    signedInAs("u1");
    membership("team_1", true);
    const response = await withLeagueActor(request(), context, async (actor) => Response.json(actor));
    expect(await response.json()).toEqual({ userId: "u1", leagueId: "league_1", teamId: "team_1", isCommissioner: true });
  });

  it("surfaces the membership lookup's own status and message", async () => {
    signedInAs("u1");
    vi.mocked(resolveLeagueMembership).mockResolvedValue({ ok: false, status: 404, error: "That league doesn't exist." });
    const response = await withLeagueActor(request(), context, async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "That league doesn't exist." });
  });
});

describe("withLeagueMemberActor", () => {
  it("lets a member through", async () => {
    signedInAs("u1");
    membership("team_1", false);
    const response = await withLeagueMemberActor(request(), context, async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(200);
  });

  it("answers 403 for a signed-in stranger with no team and no commissioner role", async () => {
    signedInAs("u1");
    membership(null, false);
    const response = await withLeagueMemberActor(request(), context, async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });
});

describe("withCommissioner", () => {
  it("lets the commissioner through", async () => {
    signedInAs("u1");
    membership(null, true);
    const response = await withCommissioner(request(), context, async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(200);
  });

  it("answers 403 for a member who isn't the commissioner", async () => {
    signedInAs("u1");
    membership("team_1", false);
    const response = await withCommissioner(request(), context, async () => new Response(null, { status: 200 }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "Only the commissioner can do that." });
  });
});
