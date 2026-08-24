import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import { OpenLeagueCard } from "./open-league-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const BASE: PublicLeagueSummary = {
  id: "hp241",
  name: "Half-PPR #241",
  format: "snake",
  experienceTier: "experienced",
  stakeTier: 0,
  teamCount: 12,
  filledTeams: 9,
  scoringLabel: "Half PPR",
  compositionCategory: "open",
  draftAt: "Thursday 10 September, 8:00 PM UTC (in 3 days)",
  medianGame: false,
  startTrigger: "scheduled",
  houseRung: "open_12",
  heldSeats: 0,
  rosterSummary: "15 slots, 1 flex",
  playoffWeeks: [15, 16, 17],
  kickoffRolls: 0,
};

// join-flow-panel.md, HIGH: "the moment it fills" is honestly distinct from a date and says
// nothing about the commitment, which is being reachable on short notice. F9/C5: this card does
// not phrase the promise — `describeStartTiming` does, and this card and the waiting room quote
// the identical string, reassurance second.
const WHEN_FULL: PublicLeagueSummary = {
  ...BASE,
  id: "sf78",
  name: "Superflex #78",
  startTrigger: "when_full",
  filledTeams: 4,
};

const BEGINNERS_ONLY_LAST_SEAT: PublicLeagueSummary = {
  ...BASE,
  id: "median13",
  name: "Median #13",
  experienceTier: "beginner",
  filledTeams: 11,
};

describe("OpenLeagueCard", () => {
  it("tells a when-full joiner what they are actually agreeing to, in the one sentence that owns it", () => {
    render(<OpenLeagueCard league={WHEN_FULL} signedIn={false} />);
    expect(
      screen.getByText(
        "This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.",
      ),
    ).toBeInTheDocument();
    // Never both a date and the sentence — the placeholder kickoff is never rendered as if
    // somebody chose it.
    expect(screen.queryByText(BASE.draftAt)).not.toBeInTheDocument();
  });

  it("says who a league is for before the button, not after the refusal", () => {
    render(<OpenLeagueCard league={BEGINNERS_ONLY_LAST_SEAT} signedIn={false} />);
    expect(screen.getByRole("link", { name: "Take the last seat in Median #13. Newer players only." })).toBeInTheDocument();
  });

  it("says 'a seat', not 'the last seat', when more than one remains", () => {
    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." })).toBeInTheDocument();
  });

  it("shows the four facts a veteran shops on: drafts, who, roster and playoffs, in both themes, axe-clean", async () => {
    await renderSurface(<OpenLeagueCard league={BASE} signedIn={false} />, async ({ container }) => {
      expect(screen.getByText("Thursday 10 September, 8:00 PM UTC (in 3 days)")).toBeInTheDocument();
      // Appears twice on this fixture: the "Who" fact AND the composition label both read "Open
      // to everyone" for an experienced-tier, `open`-composition league.
      expect(screen.getAllByText("Open to everyone").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("15 slots, 1 flex")).toBeInTheDocument();
      expect(screen.getByText("Weeks 15, 16 and 17")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("badges a house league with its rung, and a member league with its stake tier", () => {
    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.getByText("Open 12-team")).toBeInTheDocument();
    const memberLeague: PublicLeagueSummary = { ...BASE, id: "member1", houseRung: null };
    render(<OpenLeagueCard league={memberLeague} signedIn={false} />);
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("gives a signed-in visitor a real join button", () => {
    render(<OpenLeagueCard league={BASE} signedIn />);
    expect(screen.getByRole("button", { name: `Join ${BASE.name}` })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Take/ })).not.toBeInTheDocument();
  });

  it("sends a signed-out visitor into the hold interstitial for THIS league", () => {
    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.getByRole("link", { name: "Take a seat in Half-PPR #241." })).toHaveAttribute(
      "href",
      `/sign-in?returnTo=%2Fjoin%2F${BASE.id}%2Fhold`,
    );
  });

  it("offers the escape hatch to experienced players on a beginner-only card, and nowhere else", () => {
    const beginner = render(<OpenLeagueCard league={BEGINNERS_ONLY_LAST_SEAT} signedIn={false} />);
    expect(screen.getByText(/Reserved for players newer to Commish/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse leagues open to everyone" })).toHaveAttribute(
      "href",
      "/browse?experienceTier=experienced",
    );
    beginner.unmount();

    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.queryByText(/Reserved for players newer to Commish/)).not.toBeInTheDocument();
  });

  it("shows a live hold through SeatMeter's own clause", () => {
    render(<OpenLeagueCard league={{ ...BASE, heldSeats: 1 }} signedIn={false} />);
    expect(screen.getByText(/1 seat is being claimed right now/)).toBeInTheDocument();
  });

  it("carries an InfoTip on the format and the scoring label", () => {
    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.getByRole("button", { name: "What is a snake draft?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is Half PPR?" })).toBeInTheDocument();
  });

  it("opens every InfoTip guided by default, the unauthenticated-surface rule", () => {
    render(<OpenLeagueCard league={BASE} signedIn={false} />);
    expect(screen.getByRole("button", { name: "What is the playoff bracket?" })).toBeInTheDocument();
  });
});
