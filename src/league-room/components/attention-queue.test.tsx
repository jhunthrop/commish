import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { AttentionQueue, attentionQueueItemsFrom } from "./attention-queue";

const BASE_LEAGUE: HomeLeagueCard = {
  id: "l1",
  name: "Bay Bandits",
  format: "snake",
  teamCount: 10,
  filledTeams: 10,
  isCommissioner: false,
  myTeamId: "t1",
  draftId: "d1",
  draftStatus: "complete",
  record: { wins: 5, losses: 2, ties: 0 },
  weekNumber: 4,
  weekStatus: "scheduled",
  matchup: null,
  nextAction: { kind: "fix-lineup", label: "Fix your lineup" },
  lineupSet: false,
  medianGame: false,
  medianScore: null,
  kickoffAt: null,
  startTrigger: null,
  kickoffRolls: 0,
  myTeamName: "Bay Bandits Team",
};

const lineupUnset: readonly HomeLeagueCard[] = [BASE_LEAGUE];
/** The SAME league, the lineup now saved — `nextAction` falls through to `set-lineup`, which is
 *  not one of the two needs-you kinds, so `attentionQueueItemsFrom` drops it. */
const lineupSet: readonly HomeLeagueCard[] = [
  { ...BASE_LEAGUE, lineupSet: true, nextAction: { kind: "set-lineup", label: "Set your lineup" } },
];

function itemsFor(leagues: readonly HomeLeagueCard[]) {
  return attentionQueueItemsFrom(leagues);
}

describe("AttentionQueue", () => {
  it("clears an item when the thing it names is done, so nothing needs dismissing", () => {
    const { rerender } = render(<AttentionQueue items={itemsFor(lineupUnset)} />);
    expect(screen.getByText("Fix your lineup")).toBeInTheDocument();
    rerender(<AttentionQueue items={itemsFor(lineupSet)} />);
    expect(screen.queryByText("Fix your lineup")).toBeNull();
  });

  it("renders nothing at all once the queue is empty", () => {
    const { container } = render(<AttentionQueue items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names both leagues when both are join-draft and fix-lineup", () => {
    const joinDraft: HomeLeagueCard = {
      ...BASE_LEAGUE,
      id: "l2",
      name: "Iron Owls",
      draftStatus: "in_progress",
      nextAction: { kind: "join-draft", label: "Join the draft" },
    };
    render(<AttentionQueue items={attentionQueueItemsFrom([BASE_LEAGUE, joinDraft])} />);
    expect(screen.getByText("Fix your lineup")).toBeInTheDocument();
    expect(screen.getByText("Join the draft")).toBeInTheDocument();
  });

  it("sends a fix-lineup chip to the lineup editor's own anchor", () => {
    render(<AttentionQueue items={itemsFor(lineupUnset)} />);
    expect(screen.getByRole("link", { name: "Fix your lineup for Bay Bandits" })).toHaveAttribute("href", "/app/leagues/l1#lineup");
  });

  it("is axe-clean with items, in both themes", async () => {
    await renderSurface(<AttentionQueue items={itemsFor(lineupUnset)} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // LED-1 (founder-delegated design ruling, 2026-08-24): urgency order, top to bottom.
  it("ranks a live draft above every lineup fix, regardless of input order", () => {
    const fixLineup: HomeLeagueCard = { ...BASE_LEAGUE, id: "l_fix", name: "Fix Me" };
    const joinDraft: HomeLeagueCard = {
      ...BASE_LEAGUE,
      id: "l_join",
      name: "Join Me",
      draftStatus: "in_progress",
      nextAction: { kind: "join-draft", label: "Join the draft" },
    };
    const items = attentionQueueItemsFrom([fixLineup, joinDraft]);
    expect(items.map((item) => item.leagueId)).toEqual(["l_join", "l_fix"]);
  });

  it("orders lineup fixes by the earliest kickoff, once kind no longer distinguishes them", () => {
    const later: HomeLeagueCard = { ...BASE_LEAGUE, id: "l_later", name: "Later", kickoffAt: "2026-09-10T00:00:00.000Z" };
    const earlier: HomeLeagueCard = { ...BASE_LEAGUE, id: "l_earlier", name: "Earlier", kickoffAt: "2026-09-01T00:00:00.000Z" };
    const items = attentionQueueItemsFrom([later, earlier]);
    expect(items.map((item) => item.leagueId)).toEqual(["l_earlier", "l_later"]);
  });

  it("caps the rendered queue at three chips and names the real remainder in one plain sentence", () => {
    // The gauntlet's own finding: thirty-three chips, five rows deep, above a board that
    // already sorts needs-you first.
    const leagues: readonly HomeLeagueCard[] = Array.from({ length: 33 }, (_, i) => ({
      ...BASE_LEAGUE,
      id: `l${i}`,
      name: `League ${i}`,
      kickoffAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const items = attentionQueueItemsFrom(leagues);
    expect(items).toHaveLength(33);
    render(<AttentionQueue items={items} />);
    expect(screen.getAllByRole("link")).toHaveLength(LEAGUE_ROOM_CONFIG.attentionQueueCap);
    const remaining = 33 - LEAGUE_ROOM_CONFIG.attentionQueueCap;
    expect(screen.getByText(`And ${remaining} more in the board below.`)).toBeInTheDocument();
  });

  it("names no remainder when the queue does not exceed the cap", () => {
    render(<AttentionQueue items={itemsFor(lineupUnset)} />);
    expect(screen.queryByText(/more in the board below/)).toBeNull();
  });
});
