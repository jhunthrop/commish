import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { PUBLIC_LEAGUES } from "@/league-room/test-fixtures";
import { FrontDoorHero } from "./front-door-hero";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

// `OpenLeagueCta`'s signed-in branch renders `JoinPublicLeagueButton`, which calls `useRouter()`
// — the same mock `next-draft-module.test.tsx` carries for the identical reason.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// `PUBLIC_LEAGUES[0]` is a beginner-tier league, so `ctaAccessibleName` appends " Newer players
// only." — matched explicitly below rather than assumed away.
const FEATURED: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "featured_1", name: "Backyard Brawl" };

describe("FrontDoorHero", () => {
  // S8 ruling: the mock's headline and sub, verbatim — the accessible name concatenates the
  // ink phrase and the money phrase into the one sentence the e2e walk asserts.
  it("says the mock's headline verbatim, with the closing phrase in money", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole, getByText }) => {
      expect(getByRole("heading", { level: 1, name: "Real leagues. Real seats. Drafting this week." })).toBeInTheDocument();
      expect(getByText("Drafting this week.").className).toContain("text-positive");
    });
  });

  it("steps the display size responsively: display-md, then display-xl from sm up (E6)", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole }) => {
      const heading = getByRole("heading", { level: 1 });
      expect(heading.className).toContain("text-display-md");
      expect(heading.className).toContain("sm:text-display-xl");
    });
  });

  // join-flow-panel.md, HIGH: the page said nothing about money anywhere, which is honest but
  // reads as an omission to the one persona most likely to ask. The mock's `.free` line renders
  // in money too.
  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByText }) => {
      const free = getByText("Every league is free this season.");
      expect(free).toBeInTheDocument();
      expect(free.className).toContain("text-positive");
    });
  });

  // Phase 4, Task 13: the live branch, proven through injection — `moneyIsLive()` ships false
  // (`MONEY_STATES.enabled` is empty), so no real render reaches this sentence today. The
  // free-season sentence and the config can never disagree: this is the ONE other value `live`
  // can take, and the free sentence must never appear once it does.
  it("gives way to the live money sentence once a state is enabled, and never says both", async () => {
    await renderSurface(<FrontDoorHero live={true} signedIn={false} />, ({ getByText, queryByText }) => {
      const live = getByText("Play free everywhere, or play for real money where your state allows.");
      expect(live).toBeInTheDocument();
      expect(live.className).toContain("text-positive");
      expect(queryByText("Every league is free this season.")).not.toBeInTheDocument();
    });
  });

  // S8: the sub adopts the mock's one sentence; "No account is needed to look." survives as a
  // detail line — it answered a persona concern and costs one quiet line.
  it("keeps the mock's sub sentence and the quiet no-account detail line", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByText, queryByText }) => {
      expect(
        getByText(
          "Season-long fantasy football with a live draft room, real-time scoring, and a platform that runs the league so no brother-in-law has to.",
        ),
      ).toBeInTheDocument();
      expect(getByText("No account is needed to look.")).toBeInTheDocument();
      expect(queryByText(/Browse the open leagues/)).not.toBeInTheDocument();
    });
  });

  // Task 7 (hero band): headline rises first, the sub block second; reduced motion is a real
  // branch — the words stay, the animation classes go.
  it("staggers its two risers, and drops both under reduced motion", () => {
    const animated = render(<FrontDoorHero signedIn={false} />);
    expect(animated.container.querySelector(".rise-1")?.className).toContain("animate-rise");
    expect(animated.container.querySelector(".rise-2")?.className).toContain("animate-rise");
    animated.unmount();

    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const still = render(<FrontDoorHero signedIn={false} />);
    expect(still.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(still.container.querySelector(".animate-rise")).toBeNull();
    vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  });

  it("has a heading, in both themes, axe-clean", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, async ({ container, getByRole }) => {
      expect(getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // Task 9, Step 1: the quiet practice invitation, signed in and signed out — never the ink pill.
  describe("the practice invitation", () => {
    it("points a signed-in visitor straight at the practice lobby", async () => {
      await renderSurface(<FrontDoorHero signedIn={true} />, ({ getByRole }) => {
        expect(getByRole("link", { name: "Try a mock draft" })).toHaveAttribute("href", "/app/mock-drafts");
      });
    });

    // B2: the signed-out label states the truth (an account is required) before it navigates.
    it("sends a signed-out visitor through sign-up, carrying the lobby as its own intent, and says so", async () => {
      await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole }) => {
        expect(getByRole("link", { name: "Sign up and try a mock draft" })).toHaveAttribute(
          "href",
          "/sign-up?returnTo=%2Fapp%2Fmock-drafts",
        );
      });
    });
  });

  // B1 (flow analysis): the plain-language definition, verbatim, leads the signed-out front
  // door — the whole reason the first-timer persona quit was never reaching it.
  describe("the game definition (B1)", () => {
    it("says, verbatim, what a league is — the same sentence /app opens with", async () => {
      await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByText }) => {
        expect(
          getByText(
            "A league is a group of managers who draft NFL players, then start the ones they think will " +
              "score most each week. You play one other manager every week of the NFL season. Your team's " +
              "score is whatever your starters do in their real games.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("offers the fuller explainer one quiet click away, at /league-rules", async () => {
      await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole }) => {
        expect(getByRole("link", { name: "See how it works" })).toHaveAttribute("href", "/league-rules");
      });
    });
  });

  // E2 (storefront review): the hero band earns the page's own ink action once a league is
  // genuinely filling, and renders nothing at all when nothing is (rule 6).
  describe("the featured league's seat action (E2)", () => {
    it("renders no seat action at all when nothing is filling — real or absent, never dressed up", () => {
      const { queryByText } = render(<FrontDoorHero signedIn={false} featuredLeague={null} />);
      expect(queryByText(/Filling now/)).not.toBeInTheDocument();
    });

    it("gives a signed-out visitor the ink seat action for the featured league, naming it", () => {
      const { getByRole, getByText } = render(<FrontDoorHero signedIn={false} featuredLeague={FEATURED} />);
      expect(getByText(FEATURED.name)).toBeInTheDocument();
      const cta = getByRole("link", { name: `Take a seat in ${FEATURED.name}. Newer players only.` });
      expect(cta.className).toContain("bg-text-primary");
      expect(cta).toHaveAttribute("href", `/sign-in?returnTo=%2Fjoin%2F${FEATURED.id}%2Fhold`);
    });

    it("gives a signed-in visitor the real, ink join button for the featured league", () => {
      const { getByRole } = render(<FrontDoorHero signedIn={true} featuredLeague={FEATURED} />);
      const cta = getByRole("button", { name: `Join ${FEATURED.name}` });
      expect(cta.className).toContain("bg-text-primary");
    });
  });
});
