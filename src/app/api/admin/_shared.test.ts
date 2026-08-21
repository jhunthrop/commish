import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth/current-user";
import { ok } from "@/lib/api/respond";
import { withAdmin } from "./_shared";

/**
 * `requireAdmin` (`@/lib/auth/current-user`) THROWS rather than returning a result — `withAdmin`
 * is the one place that throw gets translated, so this drives it by mocking `requireAdmin`
 * itself, exactly the message it would really reject with for each caller: `null` is nobody
 * signed in at all, `"u_plain"` is a real session with no operator flag, anything else is a real
 * operator.
 */
function requestFrom(userId: string | null): Request {
  if (userId === null) {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not authenticated."));
  } else if (userId === "u_plain") {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
  } else {
    vi.mocked(requireAdmin).mockResolvedValue({
      id: userId,
      email: `${userId}@test.local`,
      displayName: userId,
      experienceTier: "beginner",
      avatarUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      isAdmin: true,
    });
  }
  return new Request("http://test/api/admin/flags");
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
});

describe("withAdmin — the API-route overload", () => {
  it("answers 404 to a signed-in non-operator, never 403", async () => {
    // The codebase's non-oracle discipline, the same reason publicJoinPrecondition and the
    // league page answer 404 for a stranger. A 403 tells somebody probing that they found the
    // admin surface and only need a session; a 404 tells them nothing they did not already have.
    const response = await withAdmin(requestFrom("u_plain"), async () => ok({}));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers 401 to a signed-out caller, because that IS the distinction worth making", async () => {
    const response = await withAdmin(requestFrom(null), async () => ok({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("never runs the handler for a non-operator", async () => {
    const handler = vi.fn();
    await withAdmin(requestFrom("u_plain"), handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("never runs the handler for a signed-out caller either", async () => {
    const handler = vi.fn();
    await withAdmin(requestFrom(null), handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler for a real operator, passing their id through", async () => {
    const handler = vi.fn(async (operatorUserId: string) => Response.json({ operatorUserId }));
    const response = await withAdmin(requestFrom("u_op"), handler);
    expect(await response.json()).toEqual({ operatorUserId: "u_op" });
  });

  it("returns a generic 500 and never leaks the real exception text when the handler throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await withAdmin(requestFrom("u_op"), async () => {
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

  it("answers a generic 500, never a false 401 or 404, for an unexpected auth failure", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("the database connection died"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await withAdmin(new Request("http://test/api/admin/flags"), async () => ok({}));
      expect(response.status).toBe(500);
      expect(consoleSpy).toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

describe("withAdmin — the Server Component overload", () => {
  it("renders notFound() for a non-operator — middleware already refused a signed-out visit", async () => {
    requestFrom("u_plain");
    await expect(withAdmin(async (operator) => operator.id)).rejects.toThrow();
  });

  it("renders the page for a real operator, passing the full operator through", async () => {
    requestFrom("u_op");
    const result = await withAdmin(async (operator) => operator);
    expect(result).toMatchObject({ id: "u_op", isAdmin: true });
  });
});
