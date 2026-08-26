import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/mock-draft-service/lobby", () => ({ mockRoomSummary: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { mockRoomSummary } from "@/mock-draft-service/lobby";
import MockDraftLandingPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

describe("MockDraftLandingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUser).mockResolvedValue(USER);
  });

  it("renders the room's own summary when the share code resolves", async () => {
    vi.mocked(mockRoomSummary).mockResolvedValue({
      ok: true,
      summary: { leagueId: "l1", shareCode: "ABC123", teamCount: 8, seatsOpen: 3, pickSeconds: 60, startsInMs: 90_000, mode: "link", started: false, alreadySeated: false },
    });
    const page = await MockDraftLandingPage({ params: Promise.resolve({ code: "ABC123" }) });
    render(page);
    expect(screen.getByText("8 teams · 60s clock")).toBeInTheDocument();
    expect(mockRoomSummary).toHaveBeenCalledWith(expect.anything(), "ABC123", "u1");
  });

  it("renders the server's own honest refusal for a stale or unknown code, never a bare 404", async () => {
    vi.mocked(mockRoomSummary).mockResolvedValue({ ok: false, status: 404, reason: "That mock draft does not exist. Check the link or start a new one." });
    const page = await MockDraftLandingPage({ params: Promise.resolve({ code: "GONE00" }) });
    render(page);
    expect(screen.getByText("We could not find that mock draft")).toBeInTheDocument();
    expect(screen.getByText(/does not exist/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the mock draft lobby" })).toHaveAttribute("href", "/app/mock-drafts");
  });
});
