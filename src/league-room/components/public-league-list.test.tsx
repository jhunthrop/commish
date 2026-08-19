import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { fixtureLeagueDeps, PUBLIC_LEAGUES, renderInLeague } from "../test-fixtures";
import { PublicLeagueList } from "./public-league-list";

// A signed-in list renders `JoinPublicLeagueButton` per card, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `league-home.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PublicLeagueList", () => {
  it("shows each league's format, tiers and fill status, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />,
      async ({ container }) => {
        expect(screen.getByText("Rookie Snake Room")).toBeInTheDocument();
        expect(screen.getByText(/3 of 12 joined/)).toBeInTheDocument();
        expect(screen.getByText(/9 of 10 joined/)).toBeInTheDocument();
        expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(fixture.calls).toEqual([]);
  });

  it("gives a signed-in visitor a join button per league", () => {
    renderInLeague(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Sharks Only Auction" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in rather than to a button that cannot work", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn={false} />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sign in to join" })[0]).toHaveAttribute("href", "/sign-in");
  });

  it("offers a next action when no league matches, rather than a dead end", async () => {
    await inBothThemes(<PublicLeagueList leagues={[]} signedIn />, async ({ container }) => {
      expect(screen.getByText("No open leagues match")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
