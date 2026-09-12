import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BrowseBody, ProofStats, WireItem } from "@/matchmaking/contract";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/league-service/browse", () => ({ listPublicLeagues: vi.fn() }));
vi.mock("@/league-service/proof", () => ({ proofStats: vi.fn() }));
vi.mock("@/league-service/proof-cache-instance", () => ({ getProofCache: vi.fn() }));
vi.mock("@/league-service/wire", () => ({ listWireItems: vi.fn() }));
vi.mock("@/review-service/reviews", () => ({ listReviews: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listPublicLeagues } from "@/league-service/browse";
import { getProofCache } from "@/league-service/proof-cache-instance";
import { listWireItems } from "@/league-service/wire";
import { listReviews } from "@/review-service/reviews";
import { UI_CONFIG } from "@/components/ui/config";
import { LEAGUE_CONFIG } from "@/league";
import { featuredLeagueId, featuredFillingLeague } from "@/league-room/components/public-league-list";
import { PUBLIC_LEAGUES } from "@/league-room/test-fixtures";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import Home from "./page";

const EMPTY_REVIEWS = { reviews: [], hasMore: false, nextBefore: null };

const EMPTY_BROWSE: BrowseBody = { leagues: [], house: [] };
const EMPTY_STATS: ProofStats = { leaguesFilled: null, roomsFillingNow: null, rating: null, tightestRoomSeatsRemaining: null, any: false };
const FULL_STATS: ProofStats = {
  leaguesFilled: 247,
  roomsFillingNow: 12,
  rating: { average: 4.8, count: 63 },
  tightestRoomSeatsRemaining: null,
  any: true,
};

async function renderHome() {
  const page = await Home();
  return render(page);
}

/** The fullest genuinely-filling league — tight enough to beat every other fixture. */
const FULLEST_FILLING: PublicLeagueSummary = {
  ...PUBLIC_LEAGUES[0]!,
  id: "front_door_fullest_filling",
  name: "Front Door Fullest Filling League",
  filledTeams: 11,
};

/** Every league at zero seats — nothing on the shelf is genuinely "filling". */
const NOTHING_FILLING: readonly PublicLeagueSummary[] = PUBLIC_LEAGUES.map((league) => ({ ...league, filledTeams: 0 }));

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue(EMPTY_BROWSE);
  vi.mocked(getProofCache)
    .mockReset()
    .mockReturnValue({ stats: vi.fn(async () => EMPTY_STATS) } as never);
  vi.mocked(listWireItems).mockReset().mockResolvedValue([]);
  vi.mocked(listReviews).mockReset().mockResolvedValue(EMPTY_REVIEWS);
});

describe("the front door (the 2026-09-02 blueprint: two doors, one page)", () => {
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderHome();
    expect(screen.getByText("Every league is free this season.")).toBeInTheDocument();
  });

  it("renders the nav links and the Take a seat doorway, pointing where the plan says", async () => {
    vi.mocked(listReviews).mockResolvedValue({
      reviews: [{ id: "r1", rating: 5, body: "Great season.", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", authorName: "A manager", authorAvatar: null, verified: false }],
      hasMore: false,
      nextBefore: null,
    });
    await renderHome();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Open leagues" })).toHaveAttribute("href", "/browse");
    expect(within(header).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
    expect(within(header).getByRole("link", { name: "Reviews" })).toHaveAttribute("href", "/reviews");
    expect(within(header).getByRole("link", { name: "Take a seat" })).toHaveAttribute("href", "/browse");
  });

  it("sits the hero on the page's own ground, no decorative background, compressed register: headline, sub, money fact, nothing that acts (SIDELINE, 2026-09-11)", async () => {
    const { container } = await renderHome();
    const heading = screen.getByRole("heading", { level: 1, name: "There is always a seat." });
    const band = heading.closest("section");
    expect(band).not.toBeNull();
    // No leftover timing-tower ground: no yard-line stripes, no gradient wash element of any kind.
    expect(container.querySelector(".floodlight")).toBeNull();
    expect(container.querySelector(".yard-lines")).toBeNull();
    expect(within(band as HTMLElement).queryAllByRole("link")).toHaveLength(0);
  });

  it("renders the one shelf head and NO filter row — the front door is the capped teaser, /browse is the lobby (D3)", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { level: 2, name: "Open leagues" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Filter open leagues" })).not.toBeInTheDocument();
  });

  it("names the shelf header's freshness sentence verbatim, never the mock's refused 'live' phrasing (F20)", async () => {
    await renderHome();
    expect(screen.getByText(/^Seat counts as of .+\. A seat being claimed is counted\.$/)).toBeInTheDocument();
  });

  it("caps the member list at shelfCap and counts the remainder honestly in the sorting sentence (D3)", async () => {
    const cap = UI_CONFIG.frontDoor.shelfCap;
    const many = Array.from({ length: cap + 2 }, (_, index) => ({
      ...PUBLIC_LEAGUES[0]!,
      id: `capped_${index + 1}`,
      name: `Capped League ${index + 1}`,
    }));
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: many, house: [] });
    await renderHome();
    expect(screen.getAllByRole("heading", { name: `Capped League ${cap}` })).toHaveLength(2);
    expect(screen.queryAllByRole("heading", { name: `Capped League ${cap + 1}` })).toHaveLength(0);
    expect(screen.getByText("Sorted by soonest draft you can still join · 2 more rooms in the full lobby")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See every open league" })).toHaveAttribute("href", "/browse");
  });

  it("drops the remainder clause when the cap held nothing back — no fabricated count", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [...PUBLIC_LEAGUES], house: [] });
    await renderHome();
    expect(screen.getByText("Sorted by soonest draft you can still join")).toBeInTheDocument();
    expect(screen.queryByText(/more rooms in the full lobby/)).not.toBeInTheDocument();
  });

  it("always asks for the default, unfiltered shelf — the front door reads no params (D3)", async () => {
    await renderHome();
    expect(vi.mocked(listPublicLeagues)).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ format: "any", experienceTier: "any", stakeTier: "any", participationTier: "any" }),
      expect.any(Object),
      { sort: "seats_remaining", whenFullOnly: false },
    );
  });

  it("threads the create sheet's defaults from the service's own LEAGUE_CONFIG — never a second copy", async () => {
    await renderHome();
    // Open the crew door's sheet: the defaults must arrive selected, straight from the constant.
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByRole("button", { name: "Start a league" }));
    expect(screen.getByRole("button", { name: `${LEAGUE_CONFIG.defaults.teamCount} teams` })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Half PPR" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(new RegExp(`${LEAGUE_CONFIG.defaults.draftDaysFromCreation} days out`))).toBeInTheDocument();
  });

  it("keeps the crew door under the shelf with an outline verb — the second door, never hidden (law 1)", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { name: "Bringing your own crew?" })).toBeInTheDocument();
    const verb = screen.getByRole("button", { name: "Start a league" });
    expect(verb.className).not.toContain("bg-accent");
  });

  it("answers the stranger's three questions in facts, with the practice door in the third card (law 4)", async () => {
    await renderHome();
    expect(screen.getByText("Who runs it")).toBeInTheDocument();
    expect(screen.getByText("What it costs")).toBeInTheDocument();
    expect(screen.getByText("Never played?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up and try a mock draft" })).toBeInTheDocument();
  });

  it("renders no proof line at all when the numbers have not earned it (law 7)", async () => {
    await renderHome();
    expect(screen.queryByTestId("proof-line")).not.toBeInTheDocument();
  });

  it("renders the earned proof numbers once proofStats clears its floors", async () => {
    vi.mocked(getProofCache).mockReturnValue({ stats: vi.fn(async () => FULL_STATS) } as never);
    await renderHome();
    expect(screen.getByTestId("proof-line").textContent).toBe("247 leagues filled this season · 12 rooms filling right now");
  });

  it("runs the wire at the page's foot when the product has earned it, on the page's own clock", async () => {
    const items: readonly WireItem[] = [
      { kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 5 * 60_000, seatsOpen: 6 },
      { kind: "league_filled", leagueName: "Iron Bowl", draftStatus: "in_progress" },
      { kind: "season_count", count: 76 },
    ];
    vi.mocked(listWireItems).mockResolvedValue(items);
    const { container } = await renderHome();
    const list = screen.getByRole("list", { name: "Recent activity" });
    // The blueprint's "lobby pulse" position: the wire is the LAST band inside main, above the footer.
    const main = container.querySelector("main");
    expect(main?.lastElementChild).toBe(list.closest(".bg-surface-inset"));
    expect(vi.mocked(listWireItems)).toHaveBeenCalledWith({}, expect.objectContaining({ now: expect.any(Function) }));
  });

  it("mounts no wire at all on a quiet product — a clean hairline, never filler", async () => {
    await renderHome();
    expect(screen.queryByRole("list", { name: "Recent activity" })).not.toBeInTheDocument();
  });

  it("renders the footer's three trust links, and leaves /league-rules to the nav", async () => {
    await renderHome();
    const footer = screen.getByRole("navigation", { name: "Legal and support" });
    expect(within(footer).getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
    expect(within(footer).getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
    // Fix round 3: the footer used to repeat the nav's own "How it works" at the same target,
    // so this page offered `/league-rules` twice under one name. The nav owns it; the footer is
    // the three legal and support links it is named for. One page, one name, one door.
    expect(within(footer).queryByRole("link", { name: "How it works" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Commish" });
    expect(within(nav).getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
  });
});

describe("the one solid amber verb (blueprint law 2 + E2's nav arithmetic)", () => {
  it("gives the solid to the fullest genuinely-filling ROW and quiets the nav pill", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [FULLEST_FILLING, PUBLIC_LEAGUES[1]!], house: [] });
    await renderHome();

    // The nav pill steps back to quiet the moment a room genuinely fills.
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Take a seat" }).className).not.toContain("bg-accent");

    // The featured row's opener wears the verb fill, in BOTH renderings (rows and cards — only
    // one is on screen past the lg boundary); everything else outlines.
    const solid = screen
      .getAllByRole("button", { name: /^Take (a seat|the last seat) in / })
      .filter((el) => el.className.includes("bg-accent"));
    expect(solid).toHaveLength(2);
    for (const verb of solid) {
      expect(verb.getAttribute("aria-label")).toContain(FULLEST_FILLING.name);
    }

    // The selection is the shelf's own featured logic — one function, one answer.
    const merged = [FULLEST_FILLING, PUBLIC_LEAGUES[1]!];
    expect(featuredFillingLeague(merged)?.id).toBe(FULLEST_FILLING.id);
    expect(featuredLeagueId(merged)).toBe(FULLEST_FILLING.id);
  });

  it("keeps the nav pill loud when nothing on the shelf is filling — the page still has one verb", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [...NOTHING_FILLING], house: [] });
    await renderHome();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Take a seat" }).className).toContain("bg-accent");
  });
});

describe("the front door's Reviews nav entry (D3)", () => {
  it("hides the Reviews nav entry when the feed has nothing real to show", async () => {
    vi.mocked(listReviews).mockResolvedValue(EMPTY_REVIEWS);
    await renderHome();
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
  });

  it("hides the Reviews nav entry when the only review is a dev/e2e fixture", async () => {
    vi.mocked(listReviews).mockResolvedValue({
      reviews: [
        {
          id: "fixture",
          rating: 1,
          body: "This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359.",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          authorName: "A manager",
          authorAvatar: null,
          verified: false,
        },
      ],
      hasMore: false,
      nextBefore: null,
    });
    await renderHome();
    expect(screen.queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
  });

  it("shows the Reviews nav entry once a real review exists", async () => {
    vi.mocked(listReviews).mockResolvedValue({
      reviews: [
        {
          id: "real",
          rating: 5,
          body: "Great season, the draft room just worked.",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          authorName: "A manager",
          authorAvatar: null,
          verified: false,
        },
      ],
      hasMore: false,
      nextBefore: null,
    });
    await renderHome();
    expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute("href", "/reviews");
  });
});
