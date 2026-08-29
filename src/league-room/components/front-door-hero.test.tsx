import { describe, it, expect, vi } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { PUBLIC_LEAGUES } from "@/league-room/test-fixtures";
import { FrontDoorHero } from "./front-door-hero";

// `OpenLeagueCta`'s signed-in branch renders `JoinPublicLeagueButton`, which calls `useRouter()`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// `PUBLIC_LEAGUES[0]` is a beginner-tier league, so `ctaAccessibleName` appends " Newer players
// only." — matched explicitly below rather than assumed away.
const FEATURED: PublicLeagueSummary = { ...PUBLIC_LEAGUES[0]!, id: "featured_1", name: "Backyard Brawl" };

/**
 * SUNDAY v5 (Direction A): the hero is two lines and the verb — the board below it is the hero.
 * These tests pin the SHAPE (one heading, one sub, the money line, the amber verb) and the three
 * deliberate retirements, so the old six-block hero cannot silently grow back.
 */
describe("FrontDoorHero", () => {
  it("says the operator's one claim as the headline, in the display face at its earned weight", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole }) => {
      const heading = getByRole("heading", { level: 1, name: "There is always a seat." });
      expect(heading.className).toContain("font-display");
      expect(heading.className).toContain("font-extrabold");
      // E6 survives v5: the display size still takes the responsive step, so 360px never wears 58px type.
      expect(heading.className).toContain("text-display-md");
      expect(heading.className).toContain("sm:text-display-xl");
    });
  });

  it("says what a seat costs, because a visitor who searched for money deserves an answer", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByText }) => {
      expect(getByText("Every league is free this season.")).toBeInTheDocument();
    });
  });

  it("gives way to the live money sentence once a state is enabled, and never says both", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} live />, ({ getByText, queryByText }) => {
      expect(getByText("Play free everywhere, or play for real money where your state allows.")).toBeInTheDocument();
      expect(queryByText("Every league is free this season.")).not.toBeInTheDocument();
    });
  });

  /**
   * The three retirements, pinned. The definition of fantasy football (B1) lives at
   * `/league-rules` behind the nav's "How it works"; "Filling now" moved to the lower third;
   * "No account is needed to look." is said structurally by the page having no wall.
   */
  it("carries none of the old hero's explainer stack — the board below is the explanation", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ queryByText, container }) => {
      expect(queryByText(/A league is a group of managers/)).not.toBeInTheDocument();
      expect(queryByText(/Filling now/)).not.toBeInTheDocument();
      expect(queryByText(/No account is needed/)).not.toBeInTheDocument();
      // One sub-sentence, not a stack: at most two <p> besides the money line is the budget.
      expect(container.querySelectorAll("p")).toHaveLength(2);
    });
  });

  it("points the verb at the lobby when nothing is genuinely filling, in the amber the verb owns", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} featuredLeague={null} />, ({ getByRole }) => {
      const verb = getByRole("link", { name: "Take a seat" });
      expect(verb).toHaveAttribute("href", "/browse");
      expect(verb.className).toContain("bg-accent");
    });
  });

  it("makes the verb the featured room's own seat when one is filling, signed out", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} featuredLeague={FEATURED} />, ({ getByRole, queryByRole }) => {
      // The fixture sits at 3 of 12, so the name is the a-seat form, not the last-seat form.
      expect(getByRole("link", { name: `Take a seat in ${FEATURED.name}. Newer players only.` })).toBeInTheDocument();
      expect(queryByRole("link", { name: "Take a seat" })).not.toBeInTheDocument(); // no generic lobby verb beside it
    });
  });

  it("gives a signed-in visitor the real join button for the featured room", async () => {
    await renderSurface(<FrontDoorHero signedIn featuredLeague={FEATURED} />, ({ getByRole }) => {
      expect(getByRole("button", { name: `Join ${FEATURED.name}` })).toBeInTheDocument();
    });
  });

  it("keeps the practice invitation as the quiet second act, never competing with the verb", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} />, ({ getByRole }) => {
      const practice = getByRole("link", { name: /mock draft/i });
      expect(practice.className).not.toContain("bg-accent");
      expect(practice.className).not.toContain("bg-text-primary");
    });
  });

  it("stays axe-clean in both themes", async () => {
    await renderSurface(<FrontDoorHero signedIn={false} featuredLeague={FEATURED} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
