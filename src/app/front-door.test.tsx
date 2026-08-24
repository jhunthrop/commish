import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BrowseBody, ProofStats } from "@/matchmaking/contract";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/browse", () => ({ listPublicLeagues: vi.fn() }));
vi.mock("@/league-service/proof", () => ({ proofStats: vi.fn() }));
vi.mock("@/league-service/proof-cache-instance", () => ({ getProofCache: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listPublicLeagues } from "@/league-service/browse";
import { getProofCache } from "@/league-service/proof-cache-instance";
import Home from "./page";

const EMPTY_BROWSE: BrowseBody = { leagues: [], house: [] };
const EMPTY_STATS: ProofStats = { leaguesFilled: null, draftsNext48h: null, rating: null, any: false };
const FULL_STATS: ProofStats = { leaguesFilled: 247, draftsNext48h: 12, rating: { average: 4.8, count: 63 }, any: true };

async function renderHome(searchParams: Record<string, string> = {}) {
  const page = await Home({ searchParams: Promise.resolve(searchParams) });
  return render(page);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue(EMPTY_BROWSE);
  vi.mocked(getProofCache)
    .mockReset()
    .mockReturnValue({ stats: vi.fn(async () => EMPTY_STATS) } as never);
});

describe("the front door (Task 5)", () => {
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderHome();
    expect(screen.getByText("Every league is free this season.")).toBeInTheDocument();
  });

  it("renders the mock's three nav links and the Take a seat CTA, both pointing where the plan says", async () => {
    await renderHome();
    expect(screen.getByRole("link", { name: "Open leagues" })).toHaveAttribute("href", "/browse");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
    expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute("href", "/reviews");
    const header = screen.getByRole("banner");
    const { getByRole } = within(header);
    expect(getByRole("link", { name: "Take a seat" })).toHaveAttribute("href", "/browse");
  });

  it("renders no proof strip at all when the numbers have not earned it", async () => {
    await renderHome();
    expect(screen.queryByText(/leagues filled this season/)).not.toBeInTheDocument();
    expect(screen.queryByText(/member rating/)).not.toBeInTheDocument();
  });

  it("renders the earned proof numbers once proofStats clears every floor", async () => {
    vi.mocked(getProofCache).mockReturnValue({ stats: vi.fn(async () => FULL_STATS) } as never);
    await renderHome();
    expect(screen.getByText("247")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read all 63 member reviews" })).toHaveAttribute("href", "/reviews");
  });

  it("names the shelf header's freshness sentence verbatim, never the mock's refused 'live' phrasing (F20)", async () => {
    await renderHome();
    expect(screen.getByText(/^Seat counts as of .+\. A seat being claimed is counted\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/Live seat counts/)).not.toBeInTheDocument();
    expect(screen.queryByText(/updated just now/)).not.toBeInTheDocument();
  });

  it("renders the shelf and the four-control filter row", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { name: "Open leagues" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Filter open leagues" })).toBeInTheDocument();
  });

  it("gives 'Start your own league' its own row, framed apart from the league cards", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { name: "Start your own league" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create a league" })).toHaveAttribute("href", "/app#create-league");
  });

  it("renders the footer's four trust links", async () => {
    await renderHome();
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
    expect(screen.getByRole("link", { name: "League rules" })).toHaveAttribute("href", "/league-rules");
  });

  it("passes 'Drafting soonest' and 'Drafts when full' straight through to listPublicLeagues, never through BrowseFilter", async () => {
    await renderHome({ sort: "soonest" });
    expect(vi.mocked(listPublicLeagues)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ format: "any", experienceTier: "any", stakeTier: "any", participationTier: "any" }),
      expect.any(Object),
      { sort: "soonest", whenFullOnly: false },
    );
  });
});
