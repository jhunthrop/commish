import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ActivityRow } from "@/integrity/activity-view";
import type { LeagueHomeBody, MatchupDetail, MatchupWeekBody } from "../contract";
import type { LineupFixPlan } from "../lib/lineup-problems";
import { HOME, MATCHUP, ROOM_DATA } from "../test-fixtures";
import { RoomStageAttention, type RoomStageAttentionProps } from "./room-stage-attention";

const noop = () => undefined;

/** One dealt card — enough to flip the stage from the expanded pulse to the compact row. */
const PLAN: LineupFixPlan = {
  problem: { slot: "RB", slotIndex: 0, reason: "empty", severity: 3, playerId: null, playerName: null, position: "RB" },
  candidates: [],
  hasProjections: false,
  totalBefore: null,
  totalAfter: null,
};

const ACTIVITY: readonly ActivityRow[] = [
  { eventId: "e1", occurredAt: "2026-09-01T12:00:00Z", icon: "inbox", headline: "Iron Owls dropped Romeo Doubs", detail: null },
  { eventId: "e2", occurredAt: "2026-09-01T11:00:00Z", icon: "inbox", headline: "Comet Crew claimed Tyjae Spears", detail: null },
];

/** A playoff pairing the viewer (t3) is not in, still to play. */
const PLAYOFF_GAME: MatchupDetail = {
  ...MATCHUP,
  weekNumber: 15,
  final: false,
  weekStatus: "scheduled",
  home: { ...MATCHUP.home, score: null },
  away: { ...MATCHUP.away, score: null },
};

function weekOf(overrides: Partial<MatchupWeekBody>): MatchupWeekBody {
  return { ...ROOM_DATA.week!, ...overrides };
}

/** `t3`'s view of `HOME`: 5-8, 3rd of 3, no matchup of their own this week. */
const OUTSIDER_HOME: LeagueHomeBody = { ...HOME, myTeamId: "t3", myMatchup: null };

function renderStage(overrides: Partial<RoomStageAttentionProps>) {
  const props: RoomStageAttentionProps = {
    home: HOME,
    lineup: null,
    week: ROOM_DATA.week,
    regularSeasonWeeks: 14,
    playoffTeams: 6,
    plans: [],
    inboxTrades: [],
    tradeContext: null,
    pendingClaims: [],
    myMatchupDetail: null,
    projectionsByPlayerId: new Map(),
    activityRows: [],
    onFixLineup: noop,
    onViewTrade: noop,
    onOpenSurface: noop,
    ...overrides,
  };
  return render(<RoomStageAttention {...props} />);
}

describe("RoomStageAttention", () => {
  it("expands the pulse to the full standings table when no cards are dealt — every team, no drawer teaser", () => {
    renderStage({ home: OUTSIDER_HOME });
    // The /standings surface's own table shape: heading, every row, both points columns.
    expect(screen.getByRole("heading", { name: "Standings" })).toBeInTheDocument();
    expect(screen.getByText("Comet Crew")).toBeInTheDocument();
    expect(screen.getByText("Points against")).toBeInTheDocument();
    expect(screen.queryByText("Full standings live in the drawer")).not.toBeInTheDocument();
  });

  it("keeps the compact pulse row when attention cards are dealt", () => {
    renderStage({ home: OUTSIDER_HOME, plans: [PLAN] });
    expect(screen.getByText("Your RB1 slot is empty")).toBeInTheDocument();
    expect(screen.getByText("Full standings live in the drawer")).toBeInTheDocument();
    expect(screen.queryByText("Points against")).not.toBeInTheDocument();
  });

  it("omits the activity card entirely when the league has no activity — no box saying nothing is new", () => {
    renderStage({ home: OUTSIDER_HOME, activityRows: [] });
    expect(screen.queryByText("Since you left")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing new since your last visit.")).not.toBeInTheDocument();
  });

  it("shows the league's recent history with the all-activity door when there is any", () => {
    renderStage({ home: OUTSIDER_HOME, activityRows: ACTIVITY });
    expect(screen.getByText("Iron Owls dropped Romeo Doubs")).toBeInTheDocument();
    expect(screen.getByText("Comet Crew claimed Tyjae Spears")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All activity" })).toBeInTheDocument();
  });

  it("tells a manager knocked out of the playoffs their finish and shows the live pairings, each tappable", () => {
    renderStage({
      home: { ...OUTSIDER_HOME, currentWeek: 15 },
      week: weekOf({ weekNumber: 15, totalWeeks: 15, matchups: [PLAYOFF_GAME], weekStatus: "scheduled" }),
    });
    expect(screen.getByText("Your season is in the books: 5-8, 3rd of 3.")).toBeInTheDocument();
    expect(screen.getByText("First round this week:")).toBeInTheDocument();
    const pairing = screen.getByRole("link", { name: "Bay Bandits vs Iron Owls" });
    expect(pairing).toHaveAttribute("href", "/app/leagues/l1/matchups/15");
    expect(screen.queryByText("No matchup this week.")).not.toBeInTheDocument();
  });

  it("wraps a finished season with the champion, the viewer's finish, and the arrival card's bookend language", () => {
    renderStage({
      home: { ...OUTSIDER_HOME, currentWeek: 15 },
      week: weekOf({ weekNumber: 15, totalWeeks: 15, matchups: [{ ...MATCHUP, weekNumber: 15 }], weekStatus: "final" }),
    });
    expect(screen.getByText("The season is in the books")).toBeInTheDocument();
    expect(screen.getByText("Bay Bandits won the championship.")).toBeInTheDocument();
    expect(screen.getByText("You finished 5-8, 3rd of 3.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the final week" })).toHaveAttribute("href", "/app/leagues/l1/matchups/15");
  });

  it("collapses a regular-season week off honestly: the fact, then the league's real pairings", () => {
    renderStage({
      home: OUTSIDER_HOME,
      week: weekOf({ matchups: [{ ...MATCHUP, final: false, home: { ...MATCHUP.home, score: null }, away: { ...MATCHUP.away, score: null } }] }),
    });
    expect(screen.getByText("No matchup for your team this week.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bay Bandits vs Iron Owls" })).toHaveAttribute("href", "/app/leagues/l1/matchups/3");
  });

  it("keeps the next-matchup card unchanged when the viewer has one", () => {
    renderStage({
      home: HOME,
      myMatchupDetail: MATCHUP,
      projectionsByPlayerId: ROOM_DATA.projectionsByPlayerId,
    });
    expect(screen.getByText("vs Iron Owls")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full matchup" })).toBeInTheDocument();
  });
});
