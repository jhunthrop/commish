import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/mock-draft-service/creation", () => ({ createMockRoom: vi.fn() }));
vi.mock("@/mock-draft-service/lobby", () => ({ listOpenMockRooms: vi.fn(), myMockRooms: vi.fn() }));
vi.mock("@/app/api/mock-drafts/_shared", () => ({
  createMockRateLimited: vi.fn(() => null),
  mockLifecycleDeps: vi.fn(() => ({})),
}));

class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Redirected(to);
  }),
  useRouter: () => ({ push: vi.fn() }),
}));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { createMockRoom } from "@/mock-draft-service/creation";
import { listOpenMockRooms, myMockRooms } from "@/mock-draft-service/lobby";
import { createMockRateLimited } from "@/app/api/mock-drafts/_shared";
import MockDraftsPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

function searchParams(query: Record<string, string> = {}) {
  return Promise.resolve(query);
}

describe("MockDraftsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUser).mockResolvedValue(USER);
    vi.mocked(createMockRateLimited).mockReturnValue(null);
    vi.mocked(listOpenMockRooms).mockResolvedValue([]);
    vi.mocked(myMockRooms).mockResolvedValue([]);
  });

  it("renders the lobby with the real config's own options when there is no ?create=solo", async () => {
    const page = await MockDraftsPage({ searchParams: searchParams() });
    render(page);
    expect(screen.getByText("Mock drafts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start mock draft" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Solo, play against bots" })).toBeInTheDocument();
  });

  it("creates a solo room and redirects straight into it on ?create=solo", async () => {
    vi.mocked(createMockRoom).mockResolvedValue({ ok: true, leagueId: "l1", teamId: "t1", draftId: "d1", shareCode: "ABC123", startsAt: "2026-08-25T12:00:00.000Z" });
    const redirected = await MockDraftsPage({ searchParams: searchParams({ create: "solo" }) }).catch((e: unknown) => e);
    expect(redirected).toBeInstanceOf(Redirected);
    expect((redirected as Redirected).to).toBe("/app/drafts/d1");
    expect(vi.mocked(createMockRoom).mock.calls[0]?.[1]).toMatchObject({ hostUserId: "u1", mode: "solo" });
  });

  it("renders the server's own refusal, never a redirect, when solo creation fails", async () => {
    vi.mocked(createMockRoom).mockResolvedValue({ ok: false, status: 429, reason: "You have started a lot of mock drafts at once. Please wait a minute and try again." });
    const page = await MockDraftsPage({ searchParams: searchParams({ create: "solo" }) });
    render(page);
    expect(screen.getByText("We could not start that mock draft")).toBeInTheDocument();
    expect(screen.getByText(/You have started a lot of mock drafts/)).toBeInTheDocument();
  });

  it("renders a rate-limit refusal without ever calling createMockRoom", async () => {
    vi.mocked(createMockRateLimited).mockReturnValueOnce({
      json: async () => ({ error: "You have started a lot of mock drafts at once. Please wait a minute and try again." }),
    } as unknown as Response);
    const page = await MockDraftsPage({ searchParams: searchParams({ create: "solo" }) });
    render(page);
    expect(screen.getByText("Too many mock drafts")).toBeInTheDocument();
    expect(createMockRoom).not.toHaveBeenCalled();
  });
});
