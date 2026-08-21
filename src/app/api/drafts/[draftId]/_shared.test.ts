import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(() => ({})),
}));

vi.mock("@/draft-service", () => ({
  resolveDraftActor: vi.fn(),
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveDraftActor } from "@/draft-service";
import { withDraftActor } from "./_shared";

const params = Promise.resolve({ draftId: "draft_1" });
const actor = { draftId: "draft_1", leagueId: "league_1", userId: "u1", teamId: "team_1", isCommissioner: false };

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(resolveDraftActor).mockReset();
});

describe("withDraftActor — error boundary", () => {
  it("returns a generic 500 and never leaks the real exception text when the handler throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "u1", email: "u1@test.local", displayName: "u1", experienceTier: "beginner", avatarUrl: null,
      createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false,
    });
    vi.mocked(resolveDraftActor).mockResolvedValue({ ok: true, actor });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await withDraftActor(new Request("http://test/api/drafts/draft_1"), { params }, async () => {
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
