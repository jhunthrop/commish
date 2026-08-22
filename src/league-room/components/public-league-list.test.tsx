import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { inBothThemes } from "@/components/ui/test-utils";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { fixtureLeagueDeps, PUBLIC_LEAGUES, renderInLeague } from "../test-fixtures";
import { PublicLeagueList } from "./public-league-list";

/** FIX 2: the missing Custom-league case — `describeScoring` can answer "Custom" and the card
 *  needs its own `InfoTip`, same as the three shipped presets. */
const CUSTOM_SCORING_LEAGUE: PublicLeagueSummary = {
  id: "p3",
  name: "House Rules League",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 1,
  teamCount: 12,
  filledTeams: 5,
  scoringLabel: "Custom",
  compositionCategory: "all_newcomers",
  draftAt: "Monday 14 September, 6:00 PM UTC (in 5 days)",
};

// A signed-in list renders `JoinPublicLeagueButton` per card, which navigates via
// `next/navigation`'s `useRouter` and throws outside a mounted App Router. Stubbing the hook
// — not the component — is the idiom `join-form.test.tsx` and `league-home.test.tsx` established.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("PublicLeagueList", () => {
  it("shows each league's format, tiers and fill status, in both themes, axe-clean", async () => {
    await inBothThemes(
      <PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />,
      async ({ container }) => {
        expect(screen.getByText("Rookie Snake Room")).toBeInTheDocument();
        expect(screen.getByText(/3 of 12 joined/)).toBeInTheDocument();
        expect(screen.getByText(/9 of 10 joined/)).toBeInTheDocument();
        expect(screen.getByText("9 spots left")).toBeInTheDocument();
        expect(screen.getByText("1 spot left")).toBeInTheDocument();
        expect(screen.getByText("All newcomers")).toBeInTheDocument();
        expect(screen.getByText("Open to everyone")).toBeInTheDocument();
        expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    // The `expect(fixture.calls).toEqual([])` that used to sit here was trivially green: the
    // fixture's deps were never provided to this render, so `calls` could not have been anything
    // else. `PublicLeagueList` renders server-shaped data and fetches nothing of its own — the
    // one interactive child (`JoinPublicLeagueButton`) owns its own request and its own test.
  });

  it("tells a visitor a beginner-tier card is reserved for newer players, with somewhere else to go", () => {
    // `PUBLIC_LEAGUES` has exactly one beginner-tier card (`p1`) and one experienced-tier card
    // (`p2`) — proactive, not reactive: this renders on the card itself, before anyone presses
    // Join, so a veteran self-selects away rather than discovering the gate only after a refusal.
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />);
    expect(screen.getByText(/Reserved for players newer to Commish/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Browse leagues open to everyone" });
    expect(link).toHaveAttribute("href", "/browse?experienceTier=experienced");
  });

  it("says nothing extra on an experienced-tier card", () => {
    render(<PublicLeagueList leagues={[PUBLIC_LEAGUES[1]!]} signedIn />);
    expect(screen.queryByText(/Reserved for players newer to Commish/)).not.toBeInTheDocument();
  });

  it("shows the scoring label beside the format, each with its own InfoTip", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />);
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("PPR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is an auction draft?" })).toBeInTheDocument();
    // "Standard" is plain English, not jargon — no InfoTip on it.
    expect(screen.queryByRole("button", { name: "What is Standard?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is PPR?" })).toBeInTheDocument();
  });

  it("carries an InfoTip on a Custom-scoring league too — bare and untipped reads as a lower-quality league", () => {
    render(<PublicLeagueList leagues={[CUSTOM_SCORING_LEAGUE]} signedIn />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is custom scoring?" })).toBeInTheDocument();
  });

  // FIX 1 (HIGH): /browse is the app's one unauthenticated surface, with no signed-in caller's
  // helpLevel to read on the common path — the rule is every InfoTip here opens guided,
  // unconditionally, not the click-only default an authenticated room falls back to.
  it("opens every InfoTip guided by default — the unauthenticated-surface rule, not a signed-in preference", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />);
    expect(screen.getByText(GLOSSARY["snake-draft"].short)).toBeInTheDocument();
    expect(screen.getByText(GLOSSARY["auction-draft"].short)).toBeInTheDocument();
    expect(screen.getByText(GLOSSARY.ppr.short)).toBeInTheDocument();
  });

  it("gives a signed-in visitor a join button per league", () => {
    renderInLeague(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Join Rookie Snake Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join Sharks Only Auction" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in, named per league so the offer reads as honest rather than a bait-and-switch", () => {
    render(<PublicLeagueList leagues={PUBLIC_LEAGUES} signedIn={false} />);
    expect(screen.queryByRole("button", { name: /^Join / })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to join Rookie Snake Room" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Sign in to join Sharks Only Auction" })).toHaveAttribute("href", "/sign-in");
  });

  it("labels the composition honestly, in the three phrases the brief names and no others", () => {
    const allNewcomers: PublicLeagueSummary = { ...CUSTOM_SCORING_LEAGUE, id: "comp_all", compositionCategory: "all_newcomers" };
    const mostlyNewcomers: PublicLeagueSummary = { ...CUSTOM_SCORING_LEAGUE, id: "comp_mostly", compositionCategory: "mostly_newcomers" };
    const open: PublicLeagueSummary = { ...CUSTOM_SCORING_LEAGUE, id: "comp_open", compositionCategory: "open" };
    render(<PublicLeagueList leagues={[allNewcomers, mostlyNewcomers, open]} signedIn />);
    expect(screen.getByText("All newcomers")).toBeInTheDocument();
    expect(screen.getByText("Mostly newcomers")).toBeInTheDocument();
    expect(screen.getByText("Open to everyone")).toBeInTheDocument();
    // Never a raw ratio or a percentage — a browse card is a decision aid, not a statistic.
    expect(screen.queryByText(/\d+ of \d+ (veteran|newcomer)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("marks the newcomer-leaning composition with a clover and everything else with a crown", () => {
    const newcomerLeaning: PublicLeagueSummary = { ...CUSTOM_SCORING_LEAGUE, id: "comp_clover", compositionCategory: "all_newcomers" };
    const notNewcomerLeaning: PublicLeagueSummary = { ...CUSTOM_SCORING_LEAGUE, id: "comp_crown", compositionCategory: "open" };
    const { container } = render(<PublicLeagueList leagues={[newcomerLeaning, notNewcomerLeaning]} signedIn />);
    // `Icon` is decorative here (no `label`), so it renders `aria-hidden` — the adjacent text
    // already carries the meaning for a screen reader, which is also what keeps this axe-clean.
    const svgs = [...container.querySelectorAll("svg[aria-hidden='true']")];
    expect(svgs.some((svg) => svg.classList.contains("lucide-clover"))).toBe(true);
    expect(svgs.some((svg) => svg.classList.contains("lucide-crown"))).toBe(true);
  });

  it("offers a next action when no league matches, rather than a dead end", async () => {
    await inBothThemes(<PublicLeagueList leagues={[]} signedIn />, async ({ container }) => {
      expect(screen.getByText("No open leagues match")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Clear the filters" })).toHaveAttribute("href", "/browse");
      expect(screen.getByRole("link", { name: "Start your own league" })).toHaveAttribute("href", "/app#create-league");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
