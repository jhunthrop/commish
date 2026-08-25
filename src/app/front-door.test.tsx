import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BrowseBody, ProofStats, WireItem } from "@/matchmaking/contract";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/browse", () => ({ listPublicLeagues: vi.fn() }));
vi.mock("@/league-service/proof", () => ({ proofStats: vi.fn() }));
vi.mock("@/league-service/proof-cache-instance", () => ({ getProofCache: vi.fn() }));
vi.mock("@/league-service/wire", () => ({ listWireItems: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listPublicLeagues } from "@/league-service/browse";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { listWireItems } from "@/league-service/wire";
import { UI_CONFIG } from "@/components/ui/config";
import { PUBLIC_LEAGUES } from "@/league-room/test-fixtures";
import Home from "./page";

const EMPTY_BROWSE: BrowseBody = { leagues: [], house: [] };
const EMPTY_STATS: ProofStats = { leaguesFilled: null, draftsNext48h: null, rating: null, nextDraftAt: null, any: false };
const FULL_STATS: ProofStats = { leaguesFilled: 247, draftsNext48h: 12, rating: { average: 4.8, count: 63 }, nextDraftAt: null, any: true };

async function renderHome() {
  const page = await Home();
  return render(page);
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue(EMPTY_BROWSE);
  vi.mocked(getProofCache)
    .mockReset()
    .mockReturnValue({ stats: vi.fn(async () => EMPTY_STATS) } as never);
  // Quiet by default — the wire's own component tests own its rendering; the page tests below
  // only assert where it mounts and that a quiet product mounts nothing.
  vi.mocked(listWireItems).mockReset().mockResolvedValue([]);
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

  it("renders the one shelf head, and NO filter row — the front door is the capped teaser, /browse is the lobby (D3)", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { level: 2, name: "Open leagues" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Filter open leagues" })).not.toBeInTheDocument();
  });

  it("caps the member list at UI_CONFIG.frontDoor.shelfCap and offers the one quiet way to the rest (D3)", async () => {
    const cap = UI_CONFIG.frontDoor.shelfCap;
    const many = Array.from({ length: cap + 2 }, (_, index) => ({
      ...PUBLIC_LEAGUES[0]!,
      id: `capped_${index + 1}`,
      name: `Capped League ${index + 1}`,
    }));
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: many, house: [] });
    await renderHome();
    // Two headings per league within the cap: the shelf renders rows for lg+ AND cards below lg
    // (Task 13's responsive pair — jsdom applies no stylesheet, so both are queryable here).
    expect(screen.getAllByRole("heading", { name: `Capped League ${cap}` })).toHaveLength(2);
    expect(screen.queryAllByRole("heading", { name: `Capped League ${cap + 1}` })).toHaveLength(0);
    expect(screen.queryAllByRole("heading", { name: `Capped League ${cap + 2}` })).toHaveLength(0);
    expect(screen.getByRole("link", { name: "See every open league" })).toHaveAttribute("href", "/browse");
  });

  it("keeps 'See every open league' a quiet pill — the shelf's featured card holds the view's card ink (D2/rule 5)", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [...PUBLIC_LEAGUES], house: [] });
    await renderHome();
    const seeEvery = screen.getByRole("link", { name: "See every open league" });
    expect(seeEvery.className).not.toContain("bg-text-primary");
    expect(seeEvery.className).toContain("border-edge");
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

  it("always asks for the default, unfiltered shelf — the front door reads no params, /browse owns filtering (D3)", async () => {
    await renderHome();
    expect(vi.mocked(listPublicLeagues)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ format: "any", experienceTier: "any", stakeTier: "any", participationTier: "any" }),
      expect.any(Object),
      { sort: "seats_remaining", whenFullOnly: false },
    );
  });

  // Task 7: the hero band is the page's one floodlit, yard-lined ground — the wrapper owns
  // overflow-hidden (Task 2's carry) so the full-bleed overlays clip at the band's own edge.
  it("grounds the hero band under the floodlight and yard lines, clipped at the band edge (Task 7)", async () => {
    const { container } = await renderHome();
    const band = container.querySelector(".floodlight");
    expect(band).not.toBeNull();
    expect(band?.className).toContain("overflow-hidden");
    expect(band?.querySelector(".yard-lines")).not.toBeNull();
    expect(band?.querySelector(".yard-lines")).toHaveAttribute("aria-hidden", "true");
    // The band holds the hero, the steps and (when earned) the proof chips.
    expect(within(band as HTMLElement).getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(within(band as HTMLElement).getByText("Pick a seat")).toBeInTheDocument();
  });

  // Task 8: the wire mounts under the nav — real events or nothing at all.
  it("runs the wire under the nav when the product has earned it, on the page's own clock (Task 8)", async () => {
    const items: readonly WireItem[] = [
      { kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 5 * 60_000, seatsOpen: 6 },
      { kind: "league_filled", leagueName: "Iron Bowl", draftStatus: "in_progress" },
      { kind: "season_count", count: 76 },
    ];
    vi.mocked(listWireItems).mockResolvedValue(items);
    await renderHome();
    const list = screen.getByRole("list", { name: "Recent activity" });
    // Under the nav: the band sits immediately between the banner and the page's main content.
    expect(screen.getByRole("banner").nextElementSibling).toBe(list.closest(".bg-surface-inset"));
    expect(vi.mocked(listWireItems)).toHaveBeenCalledWith({}, expect.objectContaining({ now: expect.any(Function) }));
  });

  it("mounts no wire at all on a quiet product — a clean hairline, never filler (Task 8)", async () => {
    await renderHome();
    expect(screen.queryByRole("list", { name: "Recent activity" })).not.toBeInTheDocument();
  });

  it("frames 'Start your own league' as a hairline-topped row, never a box (rule 4)", async () => {
    await renderHome();
    const heading = screen.getByRole("heading", { name: "Start your own league" });
    const row = heading.closest("div");
    expect(row?.className).toContain("border-t");
    expect(row?.className).not.toContain("rounded");
  });
});
