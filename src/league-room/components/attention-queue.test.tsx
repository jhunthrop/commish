import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { HomeLeagueCard } from "../contract";
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
});
