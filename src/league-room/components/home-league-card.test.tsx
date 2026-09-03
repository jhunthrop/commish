import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { WON } from "../test-fixtures";
import { HomeLeagueCard } from "./home-league-card";

const BASE: HomeLeagueCardData = {
  id: "l1",
  name: "Sunday Money",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 3,
  weekStatus: "final",
  matchup: WON,
  nextAction: { kind: "review-week", label: "See how the week went" },
  lineupSet: true,
  medianGame: false,
  medianScore: null,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Bay Bandits Team",
};

describe("HomeLeagueCard", () => {
  it("renders the league name, record, and this week's matchup, in both themes", async () => {
    await renderSurface(<HomeLeagueCard league={BASE} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: "Sunday Money" })).toHaveAttribute("href", "/app/leagues/l1");
      expect(screen.getByText("5-2")).toBeInTheDocument();
      expect(screen.getByText(/Bay Bandits/)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks the leagues the caller commissions", () => {
    render(<HomeLeagueCard league={{ ...BASE, isCommissioner: true }} />);
    expect(screen.getByText(/· Commissioner/)).toBeInTheDocument();
  });

  it("shows a plain no-matchup message with the week's own badge when there is none", () => {
    render(<HomeLeagueCard league={{ ...BASE, matchup: null, weekStatus: "scheduled" }} />);
    expect(screen.getByText(/no matchup/i)).toBeInTheDocument();
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  it("renders no action at all for a league with nothing pending, rather than a disabled button", () => {
    render(<HomeLeagueCard league={{ ...BASE, nextAction: null }} />);
    expect(screen.queryByRole("link", { name: /See how the week went/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sends a live draft's action into the draft room, not the league page", () => {
    render(
      <HomeLeagueCard
        league={{ ...BASE, draftStatus: "in_progress", nextAction: { kind: "join-draft", label: "Join the draft" } }}
      />,
    );
    expect(screen.getByRole("link", { name: "Join the draft for Sunday Money" })).toHaveAttribute("href", "/app/drafts/d1");
  });

  it("sends every other action into the league's own home", () => {
    render(<HomeLeagueCard league={{ ...BASE, nextAction: { kind: "review-week", label: "See how the week went" } }} />);
    expect(screen.getByRole("link", { name: "See how the week went for Sunday Money" })).toHaveAttribute("href", "/app/leagues/l1");
  });

  // F16: `fix-lineup`/`set-lineup` land on the editor itself, not the league home the manager
  // then has to scan — `LineupEditor` carries `id="lineup"` (Task 11 Step 1) that makes this
  // fragment land.
  it("sends a lineup action straight to the editor's own anchor", () => {
    render(<HomeLeagueCard league={{ ...BASE, nextAction: { kind: "set-lineup", label: "Set your lineup" } }} />);
    expect(screen.getByRole("link", { name: "Set your lineup for Sunday Money" })).toHaveAttribute("href", "/app/leagues/l1/team#lineup");
  });

  it("sends a fix-lineup action straight to the editor's own anchor too", () => {
    render(<HomeLeagueCard league={{ ...BASE, nextAction: { kind: "fix-lineup", label: "Fix your lineup" } }} />);
    expect(screen.getByRole("link", { name: "Fix your lineup for Sunday Money" })).toHaveAttribute("href", "/app/leagues/l1/team#lineup");
  });

  it("gives a live draft the same loud ring treatment LeagueList (the card this replaced) gave it", () => {
    const { container } = render(<HomeLeagueCard league={{ ...BASE, draftStatus: "in_progress" }} />);
    expect(container.querySelector("article")).toHaveClass("ring-2");
  });

  // FIX 1 (persona-panel review, round 2): the visible action label repeats across cards
  // ("Watch the scores" on every live league), so the accessible name has to carry what
  // distinguishes them — which league. The visible copy itself is untouched.
  it("gives two leagues sharing the same next action distinct accessible names", () => {
    const watchScores = { kind: "watch-scores" as const, label: "Watch the scores" };
    render(
      <>
        <HomeLeagueCard league={{ ...BASE, id: "l1", name: "Sunday Money", nextAction: watchScores }} />
        <HomeLeagueCard league={{ ...BASE, id: "l2", name: "Auction Night", nextAction: watchScores }} />
      </>,
    );
    const links = screen.getAllByRole("link", { name: /Watch the scores/ });
    const actionLinks = links.filter((link) => link.textContent === "Watch the scores");
    expect(actionLinks).toHaveLength(2);
    const names = actionLinks.map((link) => link.getAttribute("aria-label"));
    expect(names).toEqual(["Watch the scores for Sunday Money", "Watch the scores for Auction Night"]);
    expect(new Set(names).size).toBe(2);
    // The visible label itself is unchanged — plain, repeated copy is fine on screen.
    for (const link of actionLinks) expect(link).toHaveTextContent("Watch the scores");
  });

  // FIX 2: a bare "5-2" has no convention a casual user can lean on — the eyebrow label is
  // visible, not just an accessible-name fallback, and the whole cluster has one accessible name.
  it("gives the record both a visible 'Record' label and an accessible name", () => {
    render(<HomeLeagueCard league={BASE} />);
    expect(screen.getByText("Record")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Record: 5-2" })).toBeInTheDocument();
  });

  it("renders no record group when the league has none", () => {
    render(<HomeLeagueCard league={{ ...BASE, record: null }} />);
    expect(screen.queryByText("Record")).not.toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  // FIX 3 (regression): `LeagueList` (the card this replaced) paired the accent ring with a
  // visible "Draft live" badge — a ring alone is invisible to the accessibility tree.
  it("shows a visible 'Draft live' badge alongside the ring when the draft is live", () => {
    render(<HomeLeagueCard league={{ ...BASE, draftStatus: "in_progress" }} />);
    expect(screen.getByText("Draft live")).toBeInTheDocument();
  });

  it("shows no 'Draft live' badge when the draft is not live", () => {
    render(<HomeLeagueCard league={{ ...BASE, draftStatus: "complete" }} />);
    expect(screen.queryByText("Draft live")).not.toBeInTheDocument();
  });

  // Rule 5 / S10 (Task 9): quiet by default — a card is never assumed to be the view's one ink
  // action on its own authority. `emphasis="ink"` is the caller's own call, mirroring
  // `OpenLeagueCard`'s identical prop.
  it("wears the quiet pill by default and the ink pill only when the caller says so", () => {
    const { rerender } = render(<HomeLeagueCard league={BASE} />);
    const quiet = screen.getByRole("link", { name: "See how the week went for Sunday Money" });
    expect(quiet.className).not.toContain("bg-text-primary");
    expect(quiet.className).toContain("border-edge");

    rerender(<HomeLeagueCard league={BASE} emphasis="ink" />);
    const ink = screen.getByRole("link", { name: "See how the week went for Sunday Money" });
    expect(ink.className).toContain("bg-text-primary");
  });

  it("stays axe-clean with a live draft badge, the record group, and a named action, in both themes", async () => {
    await renderSurface(
      <HomeLeagueCard league={{ ...BASE, draftStatus: "in_progress", nextAction: { kind: "join-draft", label: "Join the draft" } }} />,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
