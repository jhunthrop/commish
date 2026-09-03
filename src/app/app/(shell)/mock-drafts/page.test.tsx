import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/mock-draft-service/creation", () => ({ createMockRoom: vi.fn() }));
vi.mock("@/mock-draft-service/lobby", () => ({ listOpenMockRooms: vi.fn(), myMockRooms: vi.fn() }));
vi.mock("@/mock-draft-service/debrief", () => ({ completedMockDebriefs: vi.fn() }));
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
import { completedMockDebriefs, type MockDebriefSummary } from "@/mock-draft-service/debrief";
import { listOpenMockRooms, myMockRooms } from "@/mock-draft-service/lobby";
import { createMockRateLimited } from "@/app/api/mock-drafts/_shared";
import { MOCK_COPY } from "@/mock-draft/config";
import MockDraftsLobbyPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

const SUMMARY: MockDebriefSummary = {
  draftId: "d_done",
  mode: "solo",
  teamCount: 12,
  seat: 8,
  startedAgoMs: 3 * 60 * 60 * 1000,
  counts: { total: 15, bestAvailable: 9, reaches: 3 },
  shapeLeader: { position: "RB", count: 4 },
  firstTeRound: 6,
  earlyBestAvailable: true,
  best: { pickNumber: 8, playerName: "Marcus Reed", position: "RB", bestAvailableDelta: 0 },
  worstReach: { pickNumber: 65, playerName: "Dalton Price", position: "TE", bestAvailableDelta: 8 },
};

function searchParams(query: Record<string, string> = {}) {
  return Promise.resolve(query);
}

describe("MockDraftsLobbyPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUser).mockResolvedValue(USER);
    vi.mocked(createMockRateLimited).mockReturnValue(null);
    vi.mocked(listOpenMockRooms).mockResolvedValue([]);
    vi.mocked(myMockRooms).mockResolvedValue([]);
    vi.mocked(completedMockDebriefs).mockResolvedValue([]);
  });

  it("leads with one verb and the chip sentence — no settings form, and an empty lobby renders NOTHING", async () => {
    const page = await MockDraftsLobbyPage({ searchParams: searchParams() });
    render(page);
    expect(screen.getByRole("button", { name: "Draft now" })).toBeInTheDocument();
    // The remembered table as a sentence of chips (server defaults on first paint).
    expect(screen.getByTestId("table-chip-teams")).toHaveTextContent("12 teams");
    expect(screen.getByTestId("table-chip-seat")).toHaveTextContent("Seat: random");
    // The doors, with outline verbs — people are a door, not a mode toggle.
    expect(screen.getByRole("button", { name: "Open lobby" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mint a link" })).toBeInTheDocument();
    // Law 2: the empty lobby is ABSENT — no list, no sentence about absence.
    expect(screen.queryByRole("list", { name: "Open lobby rooms" })).not.toBeInTheDocument();
    expect(screen.queryByText(/No mock drafts are open/)).not.toBeInTheDocument();
    // The old form is gone entirely.
    expect(screen.queryByRole("button", { name: "Start mock draft" })).not.toBeInTheDocument();
  });

  it("self-omits the learning column for a caller with no completed mocks (law 3's empty state)", async () => {
    const page = await MockDraftsLobbyPage({ searchParams: searchParams() });
    render(page);
    expect(screen.queryByText(MOCK_COPY.learningHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(MOCK_COPY.earlierHeading)).not.toBeInTheDocument();
  });

  it("renders the last mock's honest summary and the earlier rows when completed mocks exist", async () => {
    vi.mocked(completedMockDebriefs).mockResolvedValue([
      SUMMARY,
      { ...SUMMARY, draftId: "d_prev", seat: 3, teamCount: 10, counts: { total: 14, bestAvailable: 7, reaches: 2 } },
    ]);
    const page = await MockDraftsLobbyPage({ searchParams: searchParams() });
    render(page);
    expect(screen.getByText(MOCK_COPY.learningHeading)).toBeInTheDocument();
    expect(screen.getByText("9 of 15")).toBeInTheDocument();
    expect(screen.getByText(MOCK_COPY.resultsStatBestAvailableCaption)).toBeInTheDocument();
    // The notable rows: best pick and worst reach, with their stated facts.
    expect(screen.getByText("Marcus Reed")).toBeInTheDocument();
    expect(screen.getByText("8 ranked higher")).toBeInTheDocument();
    // The earlier mock as a quiet row carrying its fraction.
    expect(screen.getByText(MOCK_COPY.earlierHeading)).toBeInTheDocument();
    expect(screen.getByText("7 of 14 best available")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full debrief" })).toHaveAttribute("href", "/app/drafts/d_done");
  });

  it("creates a solo room and redirects straight into it on ?create=solo", async () => {
    vi.mocked(createMockRoom).mockResolvedValue({ ok: true, leagueId: "l1", teamId: "t1", draftId: "d1", shareCode: "ABC123", startsAt: "2026-08-25T12:00:00.000Z" });
    const redirected = await MockDraftsLobbyPage({ searchParams: searchParams({ create: "solo" }) }).catch((e: unknown) => e);
    expect(redirected).toBeInstanceOf(Redirected);
    expect((redirected as Redirected).to).toBe("/app/drafts/d1");
    expect(vi.mocked(createMockRoom).mock.calls[0]?.[1]).toMatchObject({ hostUserId: "u1", mode: "solo" });
  });

  it("renders the server's own refusal, never a redirect, when solo creation fails", async () => {
    vi.mocked(createMockRoom).mockResolvedValue({ ok: false, status: 429, reason: "You have started a lot of mock drafts at once. Please wait a minute and try again." });
    const page = await MockDraftsLobbyPage({ searchParams: searchParams({ create: "solo" }) });
    render(page);
    expect(screen.getByText("We could not start that mock draft")).toBeInTheDocument();
    expect(screen.getByText(/You have started a lot of mock drafts/)).toBeInTheDocument();
  });

  it("renders a rate-limit refusal without ever calling createMockRoom", async () => {
    vi.mocked(createMockRateLimited).mockReturnValueOnce({
      json: async () => ({ error: "You have started a lot of mock drafts at once. Please wait a minute and try again." }),
    } as unknown as Response);
    const page = await MockDraftsLobbyPage({ searchParams: searchParams({ create: "solo" }) });
    render(page);
    expect(screen.getByText("Too many mock drafts")).toBeInTheDocument();
    expect(createMockRoom).not.toHaveBeenCalled();
  });
});
