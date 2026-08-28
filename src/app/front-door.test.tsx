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

/** How many ink pills (rule 5's `bg-text-primary` fill) the WHOLE rendered page holds — the same
 *  convention `public-league-list.test.tsx`'s own `inkPillCount` uses. Before E2, the nav's "Take
 *  a seat" CTA was always one of them; since E2, the nav's own pill steps back to quiet the
 *  instant a league is genuinely filling and the HERO band's own seat action carries the page's
 *  one ink action instead — see the "Next Draft module" describe block below for both shapes. */
function inkPillCount(container: HTMLElement): number {
  return container.querySelectorAll('[class*="bg-text-primary"]').length;
}

/**
 * Review HIGH (2951353's pair), repointed by storefront review R1: `page.tsx`'s derive-once-
 * thread-twice wiring (`featuredLeague` to both `NextDraftModule` and `OpenLeagueShelf`'s
 * `featuredInHero`) needs a genuinely FILLING league to exercise — `FULLEST_FILLING` extends
 * `PUBLIC_LEAGUES[0]` with one field (`filledTeams`, tight enough to beat every other league in
 * these tests) at the call site, the same minimal-spread idiom `public-league-list.test.tsx`'s
 * own fixtures already use, rather than forking a parallel fixture set.
 */
const FULLEST_FILLING: PublicLeagueSummary = {
  ...PUBLIC_LEAGUES[0]!,
  id: "front_door_fullest_filling",
  name: "Front Door Fullest Filling League",
  filledTeams: 11,
};

/** Every league at zero seats — the shape under which nothing on the shelf is genuinely
 *  "filling" (storefront review R1), so `featuredFillingLeague` answers `null` and the hero's
 *  module stays absent. */
const NOTHING_FILLING: readonly PublicLeagueSummary[] = PUBLIC_LEAGUES.map((league) => ({ ...league, filledTeams: 0 }));

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
  vi.mocked(listPublicLeagues).mockReset().mockResolvedValue(EMPTY_BROWSE);
  vi.mocked(getProofCache)
    .mockReset()
    .mockReturnValue({ stats: vi.fn(async () => EMPTY_STATS) } as never);
  // Quiet by default — the wire's own component tests own its rendering; the page tests below
  // only assert where it mounts and that a quiet product mounts nothing.
  vi.mocked(listWireItems).mockReset().mockResolvedValue([]);
  // Empty by default — D3's own tests below override this to prove the nav link's own honesty.
  vi.mocked(listReviews).mockReset().mockResolvedValue(EMPTY_REVIEWS);
});

describe("the front door (Task 5)", () => {
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderHome();
    expect(screen.getByText("Every league is free this season.")).toBeInTheDocument();
  });

  it("renders the mock's three nav links and the Take a seat CTA, both pointing where the plan says", async () => {
    // D3: a real review, so the "Reviews" nav link has something honest to advertise — this
    // test's own purpose is the three links' hrefs, not the nav's own D3 visibility rule (its
    // own describe block below).
    vi.mocked(listReviews).mockResolvedValue({
      reviews: [{ id: "r1", rating: 5, body: "Great season.", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", authorName: "A manager", authorAvatar: null, verified: false }],
      hasMore: false,
      nextBefore: null,
    });
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

  /**
   * The gauntlet's MEDIUM said "a hairline-topped row, never a box", and that stays true: the
   * closing block is still bounded by a rule rather than wearing a card. GAMEDAY (2026-08-28)
   * moved the rule from a nested `<div>` inside the shelf section onto the block's own `<section>`
   * band — two hairlines a few pixels apart read as a rendering accident — and gave the heading a
   * display size, because the last thing a stranger reads on the storefront was the quietest thing
   * on the page. Copy is unchanged, and the way in is still QUIET: this page's one ink action
   * belongs to the seat (E2).
   */
  it("closes on a hairline-topped band, never a box, and never a second ink action (rule 4, law 5)", async () => {
    await renderHome();
    const heading = screen.getByRole("heading", { name: "Start your own league" });
    const band = heading.closest("section");
    expect(band?.className).toContain("border-t");
    expect(band?.className).not.toContain("rounded");
    const create = screen.getByRole("link", { name: "Create a league" });
    expect(create.className).not.toContain("bg-text-primary");
    expect(create.className).not.toContain("bg-accent");
  });
});

describe("the front door's Next Draft module — page-level wiring (2026-08-25 hero finding; repointed by storefront review R1; E2)", () => {
  it("mounts the module naming the shelf's own featured (fullest filling) league, leaves the shelf all-quiet, and gives the HERO the page's one ink action (rule 5, E2)", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [FULLEST_FILLING, PUBLIC_LEAGUES[1]!], house: [] });
    const { container } = await renderHome();

    // (1) the module renders and names the featured league.
    const nextDraftModule = screen.getByTestId("next-draft-module");
    expect(within(nextDraftModule).getByText(FULLEST_FILLING.name)).toBeInTheDocument();

    // (2) E2: the nav's own "Take a seat" pill steps back to quiet — the hero band's own ink
    // seat action (below) carries the page's one ink action instead.
    const header = screen.getByRole("banner");
    const navCta = within(header).getByRole("link", { name: "Take a seat" });
    expect(navCta.className).not.toContain("bg-text-primary");

    // (3) E2: the hero band itself carries an ink seat control for the SAME featured league,
    // named — this, not the nav, is now the page's one ink action. `FULLEST_FILLING` sits at its
    // own last seat (11 of 12) on a beginner-tier league, so the CTA's accessible name is the
    // same "last seat / newer players only" sentence `ctaAccessibleName` builds everywhere else —
    // the SAME name the module's own quiet CTA and the (now all-quiet) shelf rows/cards carry
    // too, so this asserts on the one INK instance among them rather than a name unique to it.
    const sameNameCtas = screen.getAllByRole("link", { name: `Take the last seat in ${FULLEST_FILLING.name}. Newer players only.` });
    const inkCtas = sameNameCtas.filter((el) => el.className.includes("bg-text-primary"));
    expect(inkCtas).toHaveLength(1);

    // (4) the page's total ink stays at exactly one — the shelf goes all-quiet (`featuredInHero`)
    // because the module IS this league's featured rendering (rule 5): two inked renderings of
    // the same league would double the one-ink-per-view budget, and the nav's own pill (2) no
    // longer counts toward it either.
    expect(inkPillCount(container)).toBe(1);

    // (5) the module names the SAME league id the shelf's own featured-selection logic
    // (`featuredLeagueId`) would independently pick for this identical merged list — proving
    // `page.tsx` derives ONE feature and threads it to both children, rather than the module and
    // the shelf each computing (and risking disagreeing on) their own.
    const merged = [FULLEST_FILLING, PUBLIC_LEAGUES[1]!];
    expect(featuredFillingLeague(merged)?.id).toBe(FULLEST_FILLING.id);
    expect(featuredLeagueId(merged)).toBe(FULLEST_FILLING.id);
    expect(within(nextDraftModule).getByText(FULLEST_FILLING.name).textContent).toBe(featuredFillingLeague(merged)!.name);
  });

  // (6) the paired case: nothing filling means no module at all and no hero seat action, so the
  // nav's own pill stays the page's one ink action, and the shelf's OWN featured pick keeps rule
  // 5's one ink action — just owned by the shelf instead of the hero.
  it("stays absent, keeps the nav's own pill inked, and lets the shelf carry its own featured ink, when nothing on the shelf is filling", async () => {
    vi.mocked(listPublicLeagues).mockResolvedValue({ leagues: [...NOTHING_FILLING], house: [] });
    const { container } = await renderHome();
    expect(screen.queryByTestId("next-draft-module")).not.toBeInTheDocument();
    expect(screen.queryByText(/Filling now/)).not.toBeInTheDocument();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Take a seat" }).className).toContain("bg-text-primary");
    // 1 nav CTA + 1 ink row + 1 ink card — both responsive shelf renderings coexist in jsdom
    // (Task 13's own pair, no stylesheet to hide either), each carrying the shelf's own single
    // featured ink since `featuredInHero` is never passed `true` in this branch.
    expect(inkPillCount(container)).toBe(3);
  });
});

/**
 * D3 (flow analysis; storefront review) — the nav's own "Reviews" link never advertises a room
 * this page already knows is empty.
 */
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
